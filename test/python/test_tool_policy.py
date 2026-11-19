"""tool_policy 单测：管理员工具集合与按名字清理。"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

PLUGIN_DIR = Path(__file__).resolve().parents[2] / "plugin" / "astrbot_plugin_world_journey"
sys.path.insert(0, str(PLUGIN_DIR))

from tool_policy import (  # noqa: E402
    ADMIN_ONLY_TOOLS,
    drop_tool_names,
    tool_needs_admin,
)


class ToolPolicyTests(unittest.TestCase):
    def test_admin_only_tools(self):
        expected = {
            "journey_go_to",
            "journey_return_home",
            "journey_accept",
            "journey_photo",
            "journey_eat",
            "journey_signpost",
        }
        self.assertEqual(set(ADMIN_ONLY_TOOLS), expected)
        for name in expected:
            self.assertTrue(tool_needs_admin(name))
        self.assertFalse(tool_needs_admin("journey_diary_write"))
        self.assertFalse(tool_needs_admin("other_plugin_tool"))

    def test_drop_tool_names_only_matches_given_names(self):
        tools = [
            SimpleNamespace(name="journey_photo"),
            SimpleNamespace(name="journey_diary_read"),
            SimpleNamespace(name="journey_some_other_plugin"),
            SimpleNamespace(name="meme_upload"),
        ]
        kept = drop_tool_names(tools, {"journey_photo", "journey_diary_read"})
        self.assertEqual(
            [tool.name for tool in kept],
            ["journey_some_other_plugin", "meme_upload"],
        )

    def test_drop_tool_names_empty_is_noop(self):
        tools = [SimpleNamespace(name="journey_photo")]
        self.assertEqual(drop_tool_names(tools, set()), tools)
        self.assertEqual(drop_tool_names(tools, None), tools)
        self.assertEqual(drop_tool_names(None, {"x"}), [])


if __name__ == "__main__":
    unittest.main()