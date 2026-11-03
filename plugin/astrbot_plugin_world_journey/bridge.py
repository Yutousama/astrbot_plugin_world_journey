"""sidecar 进程管理 + 回环 HTTP 客户端。

这一层是 Python 侧唯一碰 AstrBot 之外进程的地方：
- 找 Node（>=22），spawn `engine/sidecar.mjs serve`
- 读 stdout 的 `{"event":"listening","port":N}`，带 token 调 API
- 心跳、看门狗、退出清理
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

import aiohttp

PLUGIN_DIR = Path(__file__).resolve().parent
SIDECAR = PLUGIN_DIR / "engine" / "sidecar.mjs"
UPDATER = PLUGIN_DIR / "engine" / "update.mjs"
RAW_DIR = PLUGIN_DIR / "raw"
PROMPT_FILE = RAW_DIR / "ENV_PROMPT.md"


class BridgeError(RuntimeError):
    """"sidecar 起不来/请求失败"的错误，给命令层一句人话。"""


class SidecarBridge:
    def __init__(
        self,
        data_dir: Path,
        config: dict[str, Any],
        log: Any,
    ) -> None:
        self.data_dir = data_dir
        self.config = config
        self.log = log
        self.engine_dir = data_dir / "engine"
        self.config_path = data_dir / "engine-config.json"
        self.logs_dir = data_dir / "logs"
        self.process: asyncio.subprocess.Process | None = None
        self.session: aiohttp.ClientSession | None = None
        self.base_url = ""
        self.token = ""
        self.port = 0
        self._stdout_task: asyncio.Task[None] | None = None
        self._stderr_task: asyncio.Task[None] | None = None
        self._heartbeat_task: asyncio.Task[None] | None = None
        self._watchdog_task: asyncio.Task[None] | None = None
        self._listening = asyncio.Event()
        self._lock = asyncio.Lock()
        self._stopping = False
        self._restarts = 0
        self._stderr_tail: list[str] = []

    @property
    def ready(self) -> bool:
        return (
            self.process is not None
            and self.process.returncode is None
            and self.session is not None
            and bool(self.base_url)
        )

    @property
    def diagnostics(self) -> str:
        return "\n".join(self._stderr_tail[-20:])

    async def ensure_ready(self) -> None:
        if not self.ready:
            await self.start()

    async def start(self) -> None:
        async with self._lock:
            if self.ready or self._stopping:
                return
            await self._check_node()
            if not SIDECAR.exists():
                raise BridgeError(f"缺少 sidecar 产物：{SIDECAR}；先在仓库跑 npm run build")
            self.engine_dir.mkdir(parents=True, exist_ok=True)
            self.logs_dir.mkdir(parents=True, exist_ok=True)
            self._listening.clear()
            self.token = os.urandom(24).hex()
            env = dict(os.environ)
            env["JOURNEY_SIDECAR_TOKEN"] = self.token
            env["JOURNEY_RAW_DIR"] = str(RAW_DIR)
            args = [
                await self._node_path(),
                "--no-warnings",
                "--experimental-transform-types",
                str(SIDECAR),
                "serve",
                "--data", str(self.engine_dir),
                "--config", str(self.config_path),
                "--prompt", str(PROMPT_FILE),
                "--port", str(int(self.config.get("sidecar_port", 0) or 0)),
                "--require-heartbeat",
            ]
            if bool(self.config.get("offline", False)):
                args.append("--offline")
            if str(self.config.get("log_level", "info")).lower() == "debug":
                args.append("--verbose")
            flags = 0
            if os.name == "nt":
                flags = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
            self.log.info("[world-journey] 启动 sidecar：%s", " ".join(args[:4]))
            self.process = await asyncio.create_subprocess_exec(
                *args,
                cwd=str(PLUGIN_DIR),
                env=env,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                creationflags=flags,
            )
            self._stdout_task = asyncio.create_task(self._watch_stdout())
            self._stderr_task = asyncio.create_task(self._watch_stderr())
            try:
                await asyncio.wait_for(self._listening.wait(), timeout=25)
            except asyncio.TimeoutError as exc:
                await self.stop()
                raise BridgeError(
                    "sidecar 启动超时（25s）。Node 是否可用？日志见 "
                    f"{self.logs_dir / 'sidecar.log'}"
                ) from exc
            if self.process is None or self.process.returncode is not None:
                await self.stop()
                raise BridgeError(f"sidecar 启动即退出：{self.diagnostics or '没有 stderr'}")
            self.base_url = f"http://127.0.0.1:{self.port}"
            self.session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=float(self.config.get("request_timeout", 10) or 10)),
            )
            try:
                await self._wait_health()
            except Exception:
                await self.stop()
                raise
            self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
            self._watchdog_task = asyncio.create_task(self._watchdog_loop())
            self.log.info("[world-journey] sidecar 就绪：%s", self.base_url)

    async def stop(self) -> None:
        self._stopping = True
        for task in (self._heartbeat_task, self._watchdog_task, self._stdout_task, self._stderr_task):
            if task is not None:
                task.cancel()
        self._heartbeat_task = self._watchdog_task = self._stdout_task = self._stderr_task = None
        if self.session is not None:
            with contextlib.suppress(Exception):
                await self.session.close()
            self.session = None
        proc = self.process
        self.process = None
        self.base_url = ""
        if proc is not None and proc.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=5)
            except asyncio.TimeoutError:
                if os.name == "nt":
                    # node.CMD 之类的中转进程会留下 node.exe 子进程；按树杀。
                    with contextlib.suppress(Exception):
                        subprocess.run(
                            ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL,
                            check=False,
                        )
                with contextlib.suppress(ProcessLookupError):
                    proc.kill()
                with contextlib.suppress(Exception):
                    await proc.wait()
        self._stopping = False
        self._listening.clear()

    async def _check_node(self) -> None:
        path = await self._node_path()
        try:
            proc = await asyncio.create_subprocess_exec(
                path, "--version",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000) if os.name == "nt" else 0,
            )
            out, err = await asyncio.wait_for(proc.communicate(), timeout=5)
        except Exception as exc:
            raise BridgeError(f"找不到可用的 Node：{exc}") from exc
        text = (out or b"").decode("utf-8", "replace").strip() or (err or b"").decode("utf-8", "replace").strip()
        match = re.search(r"v?(\d+)\.(\d+)", text)
        if not match:
            raise BridgeError(f"读不出 Node 版本：{text or path}")
        major, minor = int(match.group(1)), int(match.group(2))
        if major < 22 or (major == 22 and minor < 7):
            raise BridgeError(
                f"需要 Node 22.7+（使用 --experimental-transform-types），当前：{text}；"
                "可在插件配置里指定 node_path"
            )

    async def _node_path(self) -> str:
        raw = str(self.config.get("node_path") or "").strip()
        if raw:
            return self._resolve_node_path(Path(raw))
        # AstrBot 的 PATH 里 node 可能是 components/nodejs/shims/node.CMD；
        # 直接 spawn .CMD 会留下 node.exe 子进程，所以优先找真正的 node.exe。
        found = shutil.which("node.exe") or shutil.which("node")
        if not found:
            raise BridgeError("PATH 里找不到 node；请安装 Node 22.7+ 或在插件配置里填写 node_path")
        return self._resolve_node_path(Path(found))

    async def node_executable(self) -> str:
        return await self._node_path()

    @staticmethod
    def _resolve_node_path(path: Path) -> str:
        if path.is_dir():
            path = path / ("node.exe" if os.name == "nt" else "node")
        if path.suffix.lower() in {".cmd", ".bat"}:
            candidates = [
                path.with_name("node.exe"),
                path.parent / "node.exe",
                path.parent.parent / "node.exe",
            ]
            for candidate in candidates:
                if candidate.exists():
                    return str(candidate)
            raise BridgeError(
                f"node_path 指向的是批处理包装 {path}，找不到真正的 node.exe；"
                "请直接填 node.exe 或 Node 安装目录"
            )
        if not path.exists():
            raise BridgeError(f"node_path 指向的文件不存在：{path}")
        return str(path)

    async def _watch_stdout(self) -> None:
        proc = self.process
        if proc is None or proc.stdout is None:
            return
        while True:
            try:
                line = await proc.stdout.readline()
            except Exception:
                return
            if not line:
                return
            text = line.decode("utf-8", "replace").strip()
            if not text:
                continue
            if not self.base_url:
                with contextlib.suppress(Exception):
                    data = json.loads(text)
                    if data.get("event") == "listening" and data.get("port"):
                        self.port = int(data["port"])
                        self.base_url = f"http://127.0.0.1:{self.port}"
                        self._listening.set()
                        continue
            self.log.debug("[world-journey/sidecar] %s", text)

    async def _watch_stderr(self) -> None:
        proc = self.process
        if proc is None or proc.stderr is None:
            return
        while True:
            try:
                line = await proc.stderr.readline()
            except Exception:
                return
            if not line:
                return
            text = line.decode("utf-8", "replace").rstrip()
            if not text:
                continue
            self._stderr_tail.append(text)
            if len(self._stderr_tail) > 80:
                self._stderr_tail = self._stderr_tail[-80:]
            self._append_sidecar_log(text)
            self.log.debug("[world-journey/sidecar] %s", text)

    def _append_sidecar_log(self, text: str) -> None:
        try:
            self.logs_dir.mkdir(parents=True, exist_ok=True)
            path = self.logs_dir / "sidecar.log"
            if path.exists() and path.stat().st_size > 5 * 1024 * 1024:
                path.replace(self.logs_dir / "sidecar.log.1")
            with path.open("a", encoding="utf-8") as fh:
                fh.write(text + "\n")
        except Exception:
            pass

    async def _wait_health(self) -> None:
        for _ in range(30):
            try:
                data = await self._request("GET", "/api/health", timeout=2)
                if data.get("ok"):
                    return
            except Exception:
                pass
            await asyncio.sleep(0.25)
        raise BridgeError(f"sidecar 健康检查失败：{self.diagnostics or '没有 stderr'}")

    async def _heartbeat_loop(self) -> None:
        while True:
            await asyncio.sleep(15)
            try:
                await self._request("POST", "/api/heartbeat", body={}, timeout=3)
            except Exception as exc:
                self.log.debug("[world-journey] 心跳失败：%s", exc)

    async def _watchdog_loop(self) -> None:
        while True:
            await asyncio.sleep(10)
            proc = self.process
            if proc is None or proc.returncode is None:
                continue
            if self._stopping:
                return
            self.log.warning("[world-journey] sidecar 退出（code=%s），尝试重启", proc.returncode)
            await self._restart()
            return

    async def _restart(self) -> None:
        self._restarts += 1
        if self._restarts > 5:
            self.log.error("[world-journey] sidecar 连续重启超过 5 次，停止尝试：%s", self.diagnostics)
            return
        for task in (self._heartbeat_task, self._stdout_task, self._stderr_task):
            if task is not None:
                task.cancel()
        self._heartbeat_task = self._stdout_task = self._stderr_task = None
        if self.session is not None:
            with contextlib.suppress(Exception):
                await self.session.close()
            self.session = None
        self.process = None
        await asyncio.sleep(min(10, 2 ** (self._restarts - 1)))
        try:
            await self.start()
        except Exception as exc:
            self.log.error("[world-journey] sidecar 重启失败：%s", exc)

    # ---------------- HTTP ----------------
    async def _request(
        self,
        method: str,
        path: str,
        body: Any = None,
        timeout: float | None = None,
    ) -> Any:
        session = self.session
        if session is None:
            raise BridgeError("sidecar 未启动")
        timeout_obj = aiohttp.ClientTimeout(total=timeout) if timeout else None
        headers = {"Authorization": f"Bearer {self.token}"}
        async with session.request(
            method,
            self.base_url + path,
            json=body,
            headers=headers,
            timeout=timeout_obj,
        ) as resp:
            text = await resp.text()
            try:
                data = json.loads(text) if text else {}
            except json.JSONDecodeError:
                data = {"error": text[:300]}
            if resp.status >= 400:
                # 工具/动作的业务错误交给调用方展示，不抛成 bridge 故障。
                if (path.startswith("/api/tools/") and resp.status == 400) or (
                    path in ("/api/depart", "/api/sync", "/api/photo") and resp.status in (400, 409)
                ):
                    return data
                reason = data.get("error") or data.get("reason") or text[:300]
                raise BridgeError(f"sidecar HTTP {resp.status}：{reason}")
            return data

    async def health(self) -> dict[str, Any]:
        return await self._request("GET", "/api/health")

    async def status(self) -> dict[str, Any]:
        return await self._request("GET", "/api/status")

    async def now(self) -> str:
        return await self._request_text("GET", "/api/now")

    async def prompt(self) -> str:
        return await self._request_text("GET", "/api/prompt")

    async def tools(self) -> list[dict[str, Any]]:
        data = await self._request("GET", "/api/tools")
        return list(data.get("tools") or [])

    async def call_tool(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", f"/api/tools/{name}", body=args)

    async def depart(self) -> dict[str, Any]:
        return await self._request("POST", "/api/depart", body={})

    async def sync(self) -> dict[str, Any]:
        return await self._request("POST", "/api/sync", body={})

    async def photo(self) -> dict[str, Any]:
        try:
            # 上游生图超时是 90s；HTTP 客户端不能用默认的 10s。
            return await self._request("POST", "/api/photo", body={}, timeout=150)
        except aiohttp.ServerDisconnectedError as exc:
            raise BridgeError("sidecar 连接被关闭（通常是插件正在重载/重启）；等几秒再试") from exc
        except aiohttp.ClientConnectorError as exc:
            raise BridgeError("连不上 sidecar（可能正在重启）；等几秒再试") from exc
        except asyncio.TimeoutError as exc:
            raise BridgeError("等图超过 150s；接口可能还在生成，稍后看相册") from exc

    async def events(self, after: int, limit: int = 50) -> dict[str, Any]:
        return await self._request("GET", f"/api/events?after={int(after)}&limit={int(limit)}")

    async def media(self, file: str) -> bytes:
        session = self.session
        if session is None:
            raise BridgeError("sidecar 未启动")
        headers = {"Authorization": f"Bearer {self.token}"}
        try:
            async with session.get(
                self.base_url + f"/media/{file}",
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=60),
            ) as resp:
                if resp.status != 200:
                    raise BridgeError(f"取图失败：HTTP {resp.status}")
                return await resp.read()
        except aiohttp.ClientConnectorError as exc:
            raise BridgeError("取图时连不上 sidecar；等几秒再试") from exc

    async def _request_text(self, method: str, path: str) -> str:
        session = self.session
        if session is None:
            raise BridgeError("sidecar 未启动")
        headers = {"Authorization": f"Bearer {self.token}"}
        async with session.request(method, self.base_url + path, headers=headers) as resp:
            text = await resp.text()
            if resp.status >= 400:
                raise BridgeError(f"sidecar HTTP {resp.status}：{text[:300]}")
            return text
