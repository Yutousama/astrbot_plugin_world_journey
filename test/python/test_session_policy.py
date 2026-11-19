"""session_policy 单测：不依赖 AstrBot，用 fake manager 覆盖会话级启停。"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

PLUGIN_DIR = Path(__file__).resolve().parents[2] / "plugin" / "astrbot_plugin_world_journey"
sys.path.insert(0, str(PLUGIN_DIR))

from session_policy import SessionPolicy  # noqa: E402

PLUGIN = "astrbot_plugin_world_journey"


class FakeManager:
    def __init__(self, result=True, error: Exception | None = None):
        self.result = result
        self.error = error
        self.calls: list[tuple[str, str]] = []

    async def is_plugin_enabled_for_session(self, session_id, plugin_name):
        self.calls.append((session_id, plugin_name))
        if self.error is not None:
            raise self.error
        return self.result


class KeywordOnlyManager:
    async def is_plugin_enabled_for_session(self, *, session_id, plugin_name):
        return False


class SessionPolicyTests(unittest.IsolatedAsyncioTestCase):
    async def test_disabled(self):
        policy = SessionPolicy(PLUGIN, manager=FakeManager(False))
        self.assertFalse(await policy.allows("Sion:GroupMessage:1"))

    async def test_enabled(self):
        manager = FakeManager(True)
        policy = SessionPolicy(PLUGIN, manager=manager)
        self.assertTrue(await policy.allows("Sion:GroupMessage:1"))
        self.assertEqual(manager.calls, [("Sion:GroupMessage:1", PLUGIN)])

    async def test_empty_umo_denied(self):
        policy = SessionPolicy(PLUGIN, manager=FakeManager(True))
        self.assertFalse(await policy.allows(""))
        self.assertFalse(await policy.allows(None))

    async def test_missing_manager_allows(self):
        policy = SessionPolicy(PLUGIN, manager=object())
        self.assertTrue(await policy.allows("Sion:GroupMessage:1"))

    async def test_error_fails_closed(self):
        policy = SessionPolicy(PLUGIN, manager=FakeManager(error=RuntimeError("db down")))
        self.assertFalse(await policy.allows("Sion:GroupMessage:1"))

    async def test_keyword_only_signature_fallback(self):
        policy = SessionPolicy(PLUGIN, manager=KeywordOnlyManager())
        self.assertFalse(await policy.allows("Sion:GroupMessage:1"))

    async def test_allows_event_uses_session_umo(self):
        policy = SessionPolicy(PLUGIN, manager=FakeManager(False))
        event = SimpleNamespace(unified_msg_origin="Sion:GroupMessage:1")
        self.assertFalse(await policy.allows_event(event))


if __name__ == "__main__":
    unittest.main()