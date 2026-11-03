"""主动事件泵：轮询 sidecar events，按 flush/debounce 发到 AstrBot 会话。

- `flush`：立即发。
- `debounce`：按 key 合并，等 `debounce_seconds` 后只发最新一条。
- 顺序：遇到 debounce 就暂停拉取，等它发完再继续，保证 last_seq 不会跨过未发事件。
- 崩溃重启可能重复发一条（at-least-once），不丢。
"""
from __future__ import annotations

import asyncio
import contextlib
import time
from typing import Any, Callable, Awaitable

from .bridge import SidecarBridge


class EventPump:
    def __init__(
        self,
        *,
        bridge: SidecarBridge,
        state: dict[str, Any],
        save_state: Callable[[], None],
        deliver: Callable[[str, str, bytes | None], Awaitable[None]],
        log: Any,
        enabled: bool,
        debounce_seconds: int,
        target: str,
        fallback_umo: Callable[[], str],
        image_factory: Callable[[dict[str, Any]], Awaitable[bytes | None]] | None = None,
    ) -> None:
        self.bridge = bridge
        self.state = state
        self.save_state = save_state
        self.deliver = deliver
        self.log = log
        self.enabled = enabled
        self.debounce_seconds = max(0, int(debounce_seconds))
        self.target = target.strip()
        self.fallback_umo = fallback_umo
        self.image_factory = image_factory
        self._stop = asyncio.Event()
        self._task: asyncio.Task[None] | None = None
        self._pending: dict[str, tuple[float, dict[str, Any]]] = {}

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        self._stop.set()
        task = self._task
        self._task = None
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task

    async def _run(self) -> None:
        await self._prime()
        while not self._stop.is_set():
            try:
                await self._tick()
            except asyncio.CancelledError:
                return
            except Exception as exc:
                self.log.warning("[world-journey] 事件泵出错：%s", exc)
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=2)
            except asyncio.TimeoutError:
                pass

    async def _prime(self) -> None:
        try:
            health = await self.bridge.health()
        except Exception as exc:
            self.log.warning("[world-journey] 事件泵初始化失败：%s", exc)
            return
        current_id = str(health.get("eventLogId") or "")
        last_seq = int(self.state.get("last_seq", 0) or 0)
        if self.state.get("event_log_id") != current_id or current_id == "":
            # 首次运行或事件日志重建：跳过历史，避免一启动就把旧事件全发一遍。
            self.state["event_log_id"] = current_id
            self.state["last_seq"] = int(health.get("lastSeq", 0) or 0)
            self.save_state()
            self.log.info("[world-journey] 事件泵从当前 seq=%s 开始（不回放历史）", self.state["last_seq"])
        elif last_seq > int(health.get("lastSeq", 0) or 0):
            # sidecar 事件日志被删/重建，seq 回退；重置避免永久忽略新事件。
            self.state["last_seq"] = int(health.get("lastSeq", 0) or 0)
            self._pending.clear()
            self.save_state()

    async def _tick(self) -> None:
        if not self.enabled:
            # 主动消息关着，也要跟着推进 seq，避免以后打开时补发一堆历史。
            with contextlib.suppress(Exception):
                health = await self.bridge.health()
                seq = int(health.get("lastSeq", 0) or 0)
                if seq != int(self.state.get("last_seq", 0) or 0):
                    self.state["last_seq"] = seq
                    self.state["event_log_id"] = str(health.get("eventLogId") or "")
                    self.save_state()
            return

        # 先处理到期的 debounce；没处理完就不拉新事件，保持顺序。
        if self._pending:
            due = [(k, v) for k, v in self._pending.items() if v[0] <= time.time()]
            if due:
                for key, (_, event) in sorted(due, key=lambda kv: kv[1][1].get("seq", 0)):
                    await self._send_event(event)
                    self._pending.pop(key, None)
                    self.state["last_seq"] = max(int(self.state.get("last_seq", 0) or 0), int(event.get("seq", 0) or 0))
                    self.save_state()
            # 还有未到期的 debounce；继续等，不拉新事件。
            return

        data = await self.bridge.events(int(self.state.get("last_seq", 0) or 0), 50)
        event_log_id = str(data.get("eventLogId") or "")
        if event_log_id and event_log_id != self.state.get("event_log_id"):
            # 事件日志被重建，跳过历史。
            self.state["event_log_id"] = event_log_id
            self.state["last_seq"] = int(data.get("lastSeq", 0) or 0)
            self.save_state()
            return

        events = list(data.get("events") or [])
        for event in events:
            trigger = str(event.get("trigger") or "flush")
            if trigger == "debounce":
                key = str(event.get("key") or event.get("seq"))
                self._pending[key] = (time.time() + self.debounce_seconds, event)
                return
            await self._send_event(event)
            self.state["last_seq"] = max(int(self.state.get("last_seq", 0) or 0), int(event.get("seq", 0) or 0))
            self.save_state()

    async def _send_event(self, event: dict[str, Any]) -> None:
        target = self.target or self.fallback_umo().strip()
        text = str(event.get("text") or "").strip()
        if not target:
            self.log.warning("[world-journey] 主动事件没有目标会话；只推进 seq。配置 event_target 或先和机器人说句话。")
            return

        photo_bytes: bytes | None = None
        photo = event.get("photo")
        if isinstance(photo, dict) and photo.get("file"):
            with contextlib.suppress(Exception):
                photo_bytes = await self.bridge.media(str(photo["file"]))
        if photo_bytes is None and self.image_factory is not None:
            try:
                photo_bytes = await self.image_factory(event)
            except Exception as exc:
                self.log.warning("[world-journey] 汇报配图失败（seq=%s）：%s", event.get("seq"), exc)
        for attempt in range(3):
            try:
                await self.deliver(target, text, photo_bytes)
                return
            except Exception as exc:
                if attempt >= 2:
                    self.log.warning("[world-journey] 主动消息发送失败（seq=%s）：%s", event.get("seq"), exc)
                    return
                await asyncio.sleep(1 + attempt)
