"""大肥鱼环游世界 · AstrBot 插件。

薄壳：AstrBot 的命令/工具/提示词/主动消息在这里；旅行逻辑全在 raw/ 上游引擎，
通过 engine/sidecar.mjs 的回环 HTTP 调用。上游更新时通常只重建 sidecar，不改这个文件。
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import os
import random
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

from astrbot.api import logger
from astrbot.api.event import AstrMessageEvent, filter
from astrbot.api.star import Context, Star, StarTools
from astrbot.core.agent.tool import FunctionTool
from astrbot.core.config.astrbot_config import AstrBotConfig
from astrbot.core.message.components import Image, Plain
from astrbot.core.message.message_event_result import MessageChain
from astrbot.core.provider.entities import ProviderRequest

from .access import access_allowed
from .bridge import BridgeError, RAW_DIR, SidecarBridge, UPDATER
from .config_map import write_engine_config
from .defaults import DEFAULT_SELFIE_PROMPT
from .event_pump import EventPump
from .reset import clear_memory_dir

PLUGIN_NAME = "astrbot_plugin_world_journey"


class WorldJourneyPlugin(Star):
    def __init__(self, context: Context, config: AstrBotConfig):
        super().__init__(context)
        self.context = context
        self._config_obj = config
        self.cfg: dict[str, Any] = config
        self._normalize_selfie_prompt()
        self.plugin_dir = Path(__file__).resolve().parent
        try:
            self.data_dir = Path(StarTools.get_data_dir(PLUGIN_NAME))
        except Exception:
            self.data_dir = self.plugin_dir / "data"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.engine_dir = self.data_dir / "engine"
        self.engine_dir.mkdir(parents=True, exist_ok=True)
        self.state = self._load_state()
        self.bridge = SidecarBridge(data_dir=self.data_dir, config=self.cfg, log=logger)
        self.pump: EventPump | None = None
        self._tools: list[FunctionTool] = []
        self._ready_lock = asyncio.Lock()
        self._photo_task: asyncio.Task[None] | None = None
        self._recent_reports: list[str] = []
        self._report_target = ""

    def _normalize_selfie_prompt(self) -> None:
        """空模板回填默认值，并写回 AstrBot 配置，保证设置页能看到。"""
        current = str(self.cfg.get("selfie_prompt") or "").strip()
        if current:
            return
        self.cfg["selfie_prompt"] = DEFAULT_SELFIE_PROMPT
        with contextlib.suppress(Exception):
            self._config_obj.save_config()

    # ---------------- 生命周期 ----------------
    async def initialize(self) -> None:
        if not self._enabled:
            logger.info("[world-journey] 插件在配置里关闭，不启动 sidecar。")
            return
        try:
            self._write_engine_config()
        except Exception as exc:
            logger.error("[world-journey] 配置写不出来：%s", exc)
            return
        try:
            await self._ensure_ready()
        except Exception as exc:
            logger.error("[world-journey] sidecar 启动失败：%s", exc)
            return
        self._start_pump()
        try:
            health = await self.bridge.health()
            logger.info(
                "[world-journey] 就绪：上游 %s，地址 %s，工具 %s 个",
                health.get("upstreamVersion"), self.bridge.base_url or "?", len(self._tools),
            )
        except Exception:
            logger.info("[world-journey] 就绪。")

    async def terminate(self) -> None:
        await self._cancel_photo_task()
        if self.pump is not None:
            await self.pump.stop()
            self.pump = None
        self._unregister_tools()
        with contextlib.suppress(Exception):
            await self.bridge.stop()
        self._save_state()
        logger.info("[world-journey] 已停止。")

    @property
    def _enabled(self) -> bool:
        return bool(self.cfg.get("enabled", True))

    async def _ensure_ready(self) -> None:
        if not self._enabled:
            raise BridgeError("插件在配置里关闭了")
        async with self._ready_lock:
            if self.bridge.ready:
                return
            self.bridge.config = self.cfg
            self._write_engine_config()
            await self.bridge.start()
            if not self._tools:
                await self._register_tools()

    # ---------------- 工具 ----------------
    async def _register_tools(self) -> None:
        decls = await self.bridge.tools()
        tools: list[FunctionTool] = []
        for decl in decls:
            name = str(decl.get("name") or "").strip()
            if not name:
                continue
            parameters = decl.get("parameters")
            if not isinstance(parameters, dict):
                parameters = {"type": "object", "properties": {}}
            handler = self._make_tool_handler(name)
            try:
                tools.append(FunctionTool(
                    name=name,
                    description=str(decl.get("description") or ""),
                    parameters=parameters,
                    handler=handler,
                ))
            except Exception as exc:
                logger.warning("[world-journey] 工具 %s 注册构造失败：%s", name, exc)
        if not tools:
            logger.warning("[world-journey] 上游没有返回任何工具。")
            return
        try:
            self.context.add_llm_tools(*tools)
        except AttributeError:
            # 旧版 AstrBot 兼容
            self.context.provider_manager.llm_tools.func_list.extend(tools)
        self._tools = tools
        logger.info("[world-journey] 注册工具：%s", "、".join(t.name for t in tools))

    def _make_tool_handler(self, name: str):
        plugin = self

        async def handler(event: AstrMessageEvent, **kwargs: Any) -> str:
            if not plugin._access_ok(event):
                return "这个旅行工具只在指定会话可用。"
            plugin._note_umo(event)
            try:
                await plugin._ensure_ready()
                result = await plugin.bridge.call_tool(name, kwargs)
            except Exception as exc:
                return f"旅行工具暂时不可用：{exc}"
            text = str(result.get("text") or "")
            return ("⚠ " + text) if result.get("isError") else text

        return handler

    def _unregister_tools(self) -> None:
        for tool in self._tools:
            with contextlib.suppress(Exception):
                self.context.unregister_llm_tool(tool.name)
        self._tools = []

    # ---------------- 提示词 ----------------
    @filter.on_llm_request()
    async def inject_prompt(self, event: AstrMessageEvent, req: ProviderRequest) -> None:
        if not self._access_ok(event):
            self._drop_journey_tools(req)
            return
        if not self._enabled or not bool(self.cfg.get("inject_prompt", True)):
            return
        self._note_umo(event)
        if not self.bridge.ready:
            return
        try:
            text = await self.bridge.prompt()
        except Exception as exc:
            logger.debug("[world-journey] 提示词拉取失败：%s", exc)
            return
        if text.strip():
            req.system_prompt = (req.system_prompt or "") + "\n\n" + text
        self._append_recent_reports(event, req)

    def _append_recent_reports(self, event: AstrMessageEvent, req: ProviderRequest) -> None:
        if not bool(self.cfg.get("inject_recent_reports", True)):
            return
        if not self._recent_reports or not self._report_target:
            return
        umo = str(getattr(event, "unified_msg_origin", "") or "").strip()
        if umo != self._report_target:
            return
        try:
            count = max(1, min(20, int(self.cfg.get("recent_report_count", 5) or 5)))
        except (TypeError, ValueError):
            count = 5
        reports = self._recent_reports[-count:]
        block = "\n\n最近发给这个会话的旅行汇报（从旧到新）：\n" + "\n".join(f"- {r}" for r in reports)
        req.system_prompt = (req.system_prompt or "") + block

    # ---------------- 主动消息 ----------------
    def _start_pump(self) -> None:
        if self.pump is not None:
            return
        mode = str(self.cfg.get("report_image_mode") or "off").lower()
        self.pump = EventPump(
            bridge=self.bridge,
            state=self.state,
            save_state=self._save_state,
            deliver=self._deliver,
            log=logger,
            enabled=bool(self.cfg.get("proactive_enabled", False)),
            debounce_seconds=int(self.cfg.get("debounce_seconds", 60) or 60),
            target=str(self.cfg.get("event_target") or ""),
            fallback_umo=lambda: "" if self._access_scope() == "target" else str(self.state.get("last_umo") or ""),
            image_factory=self._maybe_report_image if mode in {"always", "probability"} else None,
        )
        self.pump.start()

    async def _maybe_report_image(self, event: dict[str, Any]) -> bytes | None:
        if str(event.get("type") or "") == "journey.photo":
            return None
        if not self.cfg.get("selfie_enabled"):
            return None
        mode = str(self.cfg.get("report_image_mode") or "off").lower()
        if mode == "off":
            return None
        if mode == "probability":
            try:
                probability = max(0.0, min(1.0, float(self.cfg.get("report_image_probability", 0.3))))
            except (TypeError, ValueError):
                probability = 0.3
            if random.random() >= probability:
                return None
        try:
            return await self.bridge.reportImage(str(event.get("text") or ""))
        except Exception as exc:
            logger.warning("[world-journey] 汇报配图异常：%s", exc)
            return None

    async def _deliver(self, target: str, text: str, photo_bytes: bytes | None) -> None:
        sent = False
        for chunk in self._split_text(text):
            ok = await self.context.send_message(target, MessageChain([Plain(chunk)]))
            sent = sent or bool(ok)
            if ok is False:
                raise RuntimeError(f"没有找到匹配的平台/会话：{target}")
        if photo_bytes:
            ok = await self.context.send_message(target, MessageChain([Image.fromBytes(photo_bytes)]))
            sent = sent or bool(ok)
            if ok is False:
                raise RuntimeError(f"没有找到匹配的平台/会话：{target}")
        if not sent and not text and not photo_bytes:
            return
        if text.strip():
            snippet = text.strip()
            if len(snippet) > 1200:
                snippet = snippet[:1200] + "…"
            if not self._recent_reports or self._recent_reports[-1] != snippet:
                self._recent_reports.append(snippet)
            try:
                limit = max(1, min(20, int(self.cfg.get("recent_report_count", 5) or 5)))
            except (TypeError, ValueError):
                limit = 5
            self._recent_reports = self._recent_reports[-limit:]
            self._report_target = target

    @staticmethod
    def _split_text(text: str, size: int = 1500) -> list[str]:
        text = text.strip()
        if not text:
            return []
        return [text[i:i + size] for i in range(0, len(text), size)]

    # ---------------- 命令 ----------------
    @filter.command("journey", alias={"旅行", "她在哪"})
    async def journey(self, event: AstrMessageEvent):
        """她此刻在哪、那边几点、今晚住哪、接下来做什么。"""
        if not self._access_ok(event):
            self._deny_access(event)
            return
        try:
            await self._ensure_ready()
            text = await self.bridge.now()
        except Exception as exc:
            yield event.plain_result(f"旅行引擎没启动：{exc}")
            return
        self._note_umo(event)
        for chunk in self._split_text(text):
            yield event.plain_result(chunk)

    @filter.command("journey_depart", alias={"让她出发"})
    async def journey_depart(self, event: AstrMessageEvent):
        """手动让她出发（需要控制权限）。"""
        if not self._access_ok(event):
            self._deny_access(event)
            return
        if not self._can_control(event):
            yield event.plain_result("这个操作需要管理员；可以在插件配置里关掉 admin_only_controls。")
            return
        try:
            await self._ensure_ready()
            result = await self.bridge.depart()
        except Exception as exc:
            yield event.plain_result(f"没走成：{exc}")
            return
        yield event.plain_result(result.get("text") or result.get("reason") or "出发了。")

    @filter.command("journey_photo", alias={"旅行照片"})
    async def journey_photo(self, event: AstrMessageEvent):
        """让她现在拍一张（需要控制权限）。"""
        if not self._access_ok(event):
            self._deny_access(event)
            return
        if not self._can_control(event):
            yield event.plain_result("这个操作需要管理员；可以在插件配置里关掉 admin_only_controls。")
            return
        if self._photo_task is not None and not self._photo_task.done():
            yield event.plain_result("上一张还在拍，等出图或超时后再试。")
            return
        self._note_umo(event)
        umo = str(getattr(event, "unified_msg_origin", "") or "").strip()
        self._photo_task = asyncio.create_task(self._photo_background(umo))
        yield event.plain_result("开始拍了；出图后自动发过来，不用再发 /journey_photo。")

    async def _photo_background(self, umo: str) -> None:
        try:
            await self._ensure_ready()
            result = await self.bridge.photo()
            if not result.get("ok"):
                await self._send_plain(umo, f"没拍成：{result.get('reason') or '没拍成。'}")
                return
            text = str(result.get("text") or "拍了一张。")
            photo = result.get("photo") if isinstance(result.get("photo"), dict) else {}
            file = str(photo.get("file") or "")
            proactive = bool(self.cfg.get("proactive_enabled", False))
            event_target = str(self.cfg.get("event_target") or "").strip()
            # 主动消息开着且目标就是当前会话：让事件泵发，避免重复。
            if proactive and (not event_target or event_target == umo):
                return
            if not file:
                await self._send_plain(umo, text)
                return
            try:
                data = await self.bridge.media(file)
                await self.context.send_message(
                    umo, MessageChain([Plain(text), Image.fromBytes(data)])
                )
            except Exception as exc:
                await self._send_plain(umo, f"照片拿到了但发不出去：{exc}")
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await self._send_plain(umo, f"没拍成：{exc}")
        finally:
            self._photo_task = None

    async def _send_plain(self, target: str, text: str) -> None:
        if not target:
            return
        with contextlib.suppress(Exception):
            await self.context.send_message(target, MessageChain([Plain(text)]))

    async def _cancel_photo_task(self) -> None:
        task = self._photo_task
        self._photo_task = None
        if task is not None and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    @filter.command("journey_diary", alias={"旅行日记"})
    async def journey_diary(self, event: AstrMessageEvent):
        """读日记：/journey_diary 7、/journey_diary 2026-11、/journey_diary 2026-11-02。"""
        if not self._access_ok(event):
            self._deny_access(event)
            return
        try:
            await self._ensure_ready()
            arg = self._command_arg(event)
            args: dict[str, Any]
            if re.fullmatch(r"\d{4}-\d{2}", arg):
                args = {"month": arg}
            elif re.fullmatch(r"\d{4}-\d{2}-\d{2}", arg):
                args = {"dateKey": arg}
            elif arg.isdigit():
                args = {"days": max(1, min(60, int(arg)))}
            else:
                args = {"days": 7}
            result = await self.bridge.call_tool("journey_diary_read", args)
        except Exception as exc:
            yield event.plain_result(f"日记读不出来：{exc}")
            return
        text = str(result.get("text") or "日记还是空的。")
        for chunk in self._split_text(text):
            yield event.plain_result(chunk)

    @filter.command("journey_stats", alias={"旅行统计"})
    async def journey_stats(self, event: AstrMessageEvent):
        """走了多少天、去过多少城、日记存在哪。"""
        if not self._access_ok(event):
            self._deny_access(event)
            return
        try:
            await self._ensure_ready()
            result = await self.bridge.call_tool("journey_stats", {})
        except Exception as exc:
            yield event.plain_result(f"统计读不出来：{exc}")
            return
        yield event.plain_result(str(result.get("text") or "没有统计。"))

    @filter.command("journey_draw", alias={"旅行想去"})
    async def journey_draw(self, event: AstrMessageEvent):
        """记下想去的地方：/journey_draw 成都 一首歌。"""
        if not self._access_ok(event):
            self._deny_access(event)
            return
        arg = self._command_arg(event)
        if not arg:
            yield event.plain_result("用法：/journey_draw 成都 一首歌")
            return
        parts = arg.split(maxsplit=1)
        city = parts[0]
        why = parts[1] if len(parts) > 1 else ""
        try:
            await self._ensure_ready()
            result = await self.bridge.call_tool("journey_draw_to", {"city": city, "why": why})
        except Exception as exc:
            yield event.plain_result(f"没记下来：{exc}")
            return
        yield event.plain_result(str(result.get("text") or "记下了。"))

    @filter.command("journey_sync")
    async def journey_sync(self, event: AstrMessageEvent):
        """把她的钟拉回真实时间（需要控制权限）。"""
        if not self._access_ok(event):
            self._deny_access(event)
            return
        if not self._can_control(event):
            yield event.plain_result("这个操作需要管理员；可以在插件配置里关掉 admin_only_controls。")
            return
        try:
            await self._ensure_ready()
            result = await self.bridge.sync()
        except Exception as exc:
            yield event.plain_result(f"同步失败：{exc}")
            return
        yield event.plain_result(result.get("text") or "同步好了。")

    @filter.command("journey_debug")
    async def journey_debug(self, event: AstrMessageEvent):
        """诊断：上游版本、管道、数据目录、最后 seq。"""
        if not self._access_ok(event):
            self._deny_access(event)
            return
        if not self._can_control(event):
            yield event.plain_result("这个操作需要管理员。")
            return
        lines = [
            f"插件：{PLUGIN_NAME}",
            f"数据目录：{self.data_dir}",
            f"引擎目录：{self.engine_dir}",
            f"上游源码：{RAW_DIR}",
            f"配置：{self.data_dir / 'engine-config.json'}",
            f"sidecar：{self.bridge.base_url or '未启动'}",
            f"最后 seq：{self.state.get('last_seq', 0)}",
            f"最后会话：{self.state.get('last_umo') or '（无）'}",
            f"主动消息：{'开' if self.cfg.get('proactive_enabled') else '关'}",
        ]
        with contextlib.suppress(Exception):
            health = await self.bridge.health()
            lines.insert(1, f"上游版本：{health.get('upstreamVersion')}")
            lines.insert(2, f"sidecar 版本：{health.get('version')}")
        if self.bridge.diagnostics:
            lines.append("sidecar 最近输出：")
            lines.append(self.bridge.diagnostics[-1500:])
        yield event.plain_result("\n".join(lines))

    @filter.command("journey_reset", alias={"重置旅行"})
    async def journey_reset(self, event: AstrMessageEvent):
        """重置旅行：/journey_reset confirm。清空行程、事件、照片、日记和旅行记忆。"""
        if not self._access_ok(event):
            self._deny_access(event)
            return
        if not self._is_admin(event):
            yield event.plain_result("重置旅行只有管理员能执行。")
            return
        if not bool(self.cfg.get("allow_reset", True)):
            yield event.plain_result("配置里关闭了 allow_reset。")
            return
        arg = self._command_arg(event).strip().lower()
        if arg not in {"confirm", "yes", "确认", "确定"}:
            yield event.plain_result(
                "这会清空：当前位置/路线/事件、照片、日记、去过/想去/花销，以及同步盘里的旅行记忆。\n"
                "配置（home_city、倍速、API key、参考图）会保留。\n"
                "确定要重新开始，请发：/journey_reset confirm"
            )
            return
        yield event.plain_result("正在重置旅行数据；sidecar 会短暂停止。")
        try:
            await self._reset_journey()
        except Exception as exc:
            yield event.plain_result(f"重置失败：{exc}")
            return
        yield event.plain_result("已重置。她回到出发地，日记、照片和旅行记忆都清空了。")

    @filter.command("journey_update")
    async def journey_update(self, event: AstrMessageEvent):
        """从 npm 更新上游源码：/journey_update [latest|版本]（需要控制权限）。"""
        if not self._access_ok(event):
            self._deny_access(event)
            return
        if not self._can_control(event):
            yield event.plain_result("这个操作需要管理员。")
            return
        if not bool(self.cfg.get("allow_upstream_update", True)):
            yield event.plain_result("配置里关闭了 allow_upstream_update。")
            return
        version = self._command_arg(event) or "latest"
        yield event.plain_result(
            f"正在从 npm 更新上游源码（{version}）；会短暂停掉 sidecar，完成后自动恢复。"
        )
        try:
            result = await self._update_upstream(version)
        except Exception as exc:
            yield event.plain_result(f"更新失败：{exc}")
            return
        if result.get("upToDate"):
            yield event.plain_result(f"已经是最新：{result.get('version')}，没有重启。")
            return
        yield event.plain_result(
            f"已更新到上游 {result.get('version')}（旧版 {result.get('oldVersion') or '无'}），"
            "工具已重新注册。"
        )

    # ---------------- 上游更新 ----------------
    async def _update_upstream(self, version: str) -> dict[str, Any]:
        node = await self.bridge.node_executable()
        updater = str(UPDATER)
        if not Path(updater).exists():
            raise BridgeError(f"缺少更新器：{updater}；先跑 npm run build")
        args = [
            node,
            "--no-warnings",
            updater,
            "--target", str(RAW_DIR),
            "--version", version,
            "--package", str(self.cfg.get("upstream_package") or "coopani-world-journey"),
            "--registry", str(self.cfg.get("upstream_registry") or "https://registry.npmjs.org"),
            "--json",
        ]
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000) if os.name == "nt" else 0
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            creationflags=flags,
        )
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=180)
        except asyncio.TimeoutError:
            with contextlib.suppress(Exception):
                proc.kill()
            raise BridgeError("更新下载超时（180s）") from None
        stdout = (out or b"").decode("utf-8", "replace").strip()
        stderr = (err or b"").decode("utf-8", "replace").strip()
        if not stdout:
            raise BridgeError(f"更新器没有输出：{stderr[-500:]}")
        try:
            data = json.loads(stdout.splitlines()[-1])
        except json.JSONDecodeError:
            raise BridgeError(f"更新器输出看不懂：{stdout[-500:]}")
        if proc.returncode != 0 or not data.get("ok"):
            raise BridgeError(str(data.get("error") or stderr[-500:] or "更新器失败"))
        if data.get("upToDate"):
            return data
        old_version = data.get("oldVersion") or "none"
        stage = Path(str(data.get("stage") or ""))
        if not stage.exists():
            raise BridgeError(f"更新器没有留下 staging：{stage}")
        workdir = stage.parent
        backup = self.plugin_dir / f".raw.bak-{old_version}"

        # 先停泵/停 sidecar，再换源码；失败则回滚并恢复旧引擎。
        await self._cancel_photo_task()
        if self.pump is not None:
            await self.pump.stop()
            self.pump = None
        await self.bridge.stop()
        self._unregister_tools()
        if backup.exists():
            _force_rmtree(backup)
        try:
            if RAW_DIR.exists():
                RAW_DIR.rename(backup)
            stage.rename(RAW_DIR)
        except Exception:
            if backup.exists() and not RAW_DIR.exists():
                backup.rename(RAW_DIR)
            raise
        try:
            await self.bridge.start()
            await self._register_tools()
            self._start_pump()
        except Exception as exc:
            with contextlib.suppress(Exception):
                await self.bridge.stop()
            _force_rmtree(RAW_DIR)
            if backup.exists():
                backup.rename(RAW_DIR)
            try:
                await self.bridge.start()
                await self._register_tools()
                self._start_pump()
            except Exception as restore_exc:
                raise BridgeError(
                    f"新上游启动失败（{exc}），回滚后仍失败：{restore_exc}"
                ) from exc
            raise BridgeError(f"新上游启动失败，已回滚：{exc}") from exc
        with contextlib.suppress(Exception):
            _force_rmtree(backup)
        with contextlib.suppress(Exception):
            _force_rmtree(workdir)
        return data

    # ---------------- 重置旅行 ----------------
    async def _reset_journey(self) -> None:
        memory_dir = self._effective_memory_dir()
        await self._cancel_photo_task()
        if self.pump is not None:
            await self.pump.stop()
            self.pump = None
        self._unregister_tools()
        await self.bridge.stop()

        if self.engine_dir.exists():
            _force_rmtree(self.engine_dir)
        self.engine_dir.mkdir(parents=True, exist_ok=True)
        if memory_dir is not None:
            clear_memory_dir(memory_dir, self.engine_dir)

        # 保留 last_umo（主动消息还发同一个会话），只重置事件游标。
        self.state["last_seq"] = 0
        self.state["event_log_id"] = ""
        self._recent_reports = []
        self._report_target = ""
        self._save_state()

        # 旧 bridge 的 EventLog/MediaStore 缓存了旧目录内容，必须换新实例。
        self.bridge = SidecarBridge(data_dir=self.data_dir, config=self.cfg, log=logger)
        await self.bridge.start()
        await self._register_tools()
        self._start_pump()

    def _effective_memory_dir(self) -> Path | None:
        raw = ""
        try:
            payload = json.loads((self.data_dir / "engine-config.json").read_text(encoding="utf-8"))
            raw = str((payload.get("engine") or {}).get("memoryDir") or "")
        except Exception:
            raw = str(self.cfg.get("memory_dir") or "")
        if not raw.strip():
            return None
        path = Path(raw).expanduser()
        if not path.is_absolute():
            path = (self.plugin_dir / path).resolve()
        return path

    # ---------------- 工具 ----------------
    def _access_scope(self) -> str:
        return "target" if str(self.cfg.get("access_scope") or "all").lower() == "target" else "all"

    def _access_ok(self, event: AstrMessageEvent) -> bool:
        return access_allowed(
            self.cfg.get("access_scope"),
            self.cfg.get("event_target"),
            getattr(event, "unified_msg_origin", ""),
        )

    @staticmethod
    def _deny_access(event: AstrMessageEvent) -> None:
        # 非目标会话连通用 LLM 回复都不给，避免“插件没响应但模型接话”。
        with contextlib.suppress(Exception):
            event.stop_event()

    def _is_admin(self, event: AstrMessageEvent) -> bool:
        try:
            return bool(event.is_admin())
        except Exception:
            return False

    @staticmethod
    def _drop_journey_tools(req: ProviderRequest) -> None:
        """非目标会话连工具 schema 都不给，避免模型看到再尝试。"""
        toolset = getattr(req, "func_tool", None)
        tools = getattr(toolset, "tools", None)
        if isinstance(tools, list):
            kept = [t for t in tools if not str(getattr(t, "name", "")).startswith("journey_")]
            if len(kept) != len(tools):
                toolset.tools = kept

    def _can_control(self, event: AstrMessageEvent) -> bool:
        if not bool(self.cfg.get("admin_only_controls", True)):
            return True
        try:
            return bool(event.is_admin())
        except Exception:
            return False

    def _command_arg(self, event: AstrMessageEvent) -> str:
        text = str(getattr(event, "message_str", "") or "").strip()
        parts = text.split(maxsplit=1)
        return parts[1].strip() if len(parts) > 1 else ""

    def _note_umo(self, event: AstrMessageEvent) -> None:
        umo = str(getattr(event, "unified_msg_origin", "") or "").strip()
        if umo and umo != self.state.get("last_umo"):
            self.state["last_umo"] = umo
            self._save_state()

    # ---------------- 状态 ----------------
    def _write_engine_config(self) -> None:
        path = self.data_dir / "engine-config.json"
        try:
            write_engine_config(path, self.cfg)
        except Exception as exc:
            # extra_config 是最可能写坏的；退一步用其余字段，不要整个插件起不来。
            logger.warning("[world-journey] 配置解析失败，忽略 extra_config 重试：%s", exc)
            fallback = dict(self.cfg)
            fallback["extra_config"] = ""
            write_engine_config(path, fallback)

    def _state_path(self) -> Path:
        return self.data_dir / "plugin_state.json"

    def _load_state(self) -> dict[str, Any]:
        path = self._state_path()
        try:
            if path.exists():
                raw = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(raw, dict):
                    return {
                        "last_seq": int(raw.get("last_seq", 0) or 0),
                        "last_umo": str(raw.get("last_umo") or ""),
                        "event_log_id": str(raw.get("event_log_id") or ""),
                    }
        except Exception:
            pass
        return {"last_seq": 0, "last_umo": "", "event_log_id": ""}

    def _save_state(self) -> None:
        try:
            path = self._state_path()
            tmp = path.with_name(path.name + ".tmp")
            tmp.write_text(json.dumps(self.state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            os.replace(tmp, path)
        except Exception:
            pass


def _force_rmtree(path: Path) -> None:
    """删除可能带只读属性的目录（Windows 更新/回滚用）。"""
    def on_error(func, target, _exc):
        with contextlib.suppress(Exception):
            os.chmod(target, 0o666)
            func(target)

    shutil.rmtree(path, onerror=on_error)
