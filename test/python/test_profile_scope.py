"""profile_scope 的纯逻辑单测。

运行：
    python -m unittest discover -s test/python -p "test_*.py" -v

不依赖 AstrBot，用假 context / 配置管理器复现「多配置文件 + plugin_set + UMO 路由」。
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

PLUGIN_DIR = Path(__file__).resolve().parents[2] / "plugin" / "astrbot_plugin_world_journey"
sys.path.insert(0, str(PLUGIN_DIR))

from types import SimpleNamespace

from profile_scope import (  # noqa: E402
    ProfileScope,
    decide_access,
    event_plugin_allowed,
    is_auto_profile,
    owner_ready,
    profile_umo,
    target_allowed,
)

PLUGIN = "astrbot_plugin_world_journey"


class FakeConfig(dict):
    """最小 AstrBotConfig 假件：dict + config_path。"""

    def __init__(self, path: str, plugin_set=None):
        super().__init__()
        self.config_path = path
        if plugin_set is not None:
            self["plugin_set"] = plugin_set


class FakeManager:
    def __init__(self, profiles: list[dict], routing: dict[str, str] | None = None):
        self.routing = dict(routing or {})
        self.confs: dict[str, FakeConfig] = {}
        self._infos: list[dict[str, str]] = []
        for profile in profiles:
            conf_id = profile["id"]
            path = profile["path"]
            self.confs[conf_id] = FakeConfig(path, profile.get("plugin_set"))
            self._infos.append(
                {"id": conf_id, "name": profile.get("name", ""), "path": path}
            )
        self.default_conf = self.confs["default"]

    def get_conf_list(self):
        return list(self._infos)

    def get_conf_info(self, umo: str):
        conf_id = self.routing.get(umo, "default")
        for info in self._infos:
            if info["id"] == conf_id:
                return dict(info)
        return {"id": "default", "name": "default", "path": "cmd_config.json"}


class FakeContext:
    def __init__(self, manager, routing: dict[str, str] | None = None):
        self.astrbot_config_mgr = manager
        self.routing = dict(routing or {})

    def get_config(self, umo=None):
        conf_id = self.routing.get(umo or "", "default")
        return self.astrbot_config_mgr.confs[conf_id]


PROFILES = [
    {"id": "default", "name": "default", "path": "cmd_config.json", "plugin_set": ["*"]},
    {"id": "sion", "name": "Sion", "path": "abconf_sion.json", "plugin_set": ["*"]},
    {
        "id": "public",
        "name": "Sion_public",
        "path": "abconf_public.json",
        "plugin_set": ["other_plugin"],
    },
    {
        "id": "disabled",
        "name": "禁用配置",
        "path": "abconf_disabled.json",
        "plugin_set": ["other_plugin"],
    },
]
ROUTING = {
    "Sion:FriendMessage:1": "sion",  # owner 私聊
    "Sion:GroupMessage:2": "public",  # 显式禁用了本插件
    "Sion:GroupMessage:3": "disabled",  # 显式禁用了本插件
    "Sion:GroupMessage:4": "sion",  # 同属 owner 配置，但不在 access_scope=target 内
    "": "default",
}


def make_scope(context=None) -> ProfileScope:
    return ProfileScope(
        context or FakeContext(FakeManager(PROFILES), ROUTING), PLUGIN
    )


def always_ok(_umo: str) -> bool:
    return True


def target_only(target: str):
    def _ok(umo: str) -> bool:
        return umo == target

    return _ok


class ProfileScopeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.scope = make_scope()

    def test_supported(self) -> None:
        self.assertTrue(self.scope.supported)
        self.assertFalse(ProfileScope(object(), PLUGIN).supported)

    def test_key_for_umo(self) -> None:
        self.assertEqual(
            self.scope.key_for_umo("Sion:FriendMessage:1"), "abconf_sion.json"
        )
        self.assertEqual(
            self.scope.key_for_umo("Sion:GroupMessage:2"), "abconf_public.json"
        )
        self.assertEqual(self.scope.key_for_umo(""), "cmd_config.json")
        self.assertEqual(self.scope.key_for_umo("unrouted:x:y"), "cmd_config.json")
        self.assertEqual(self.scope.default_key(), "cmd_config.json")

    def test_find_by_name_id_and_path(self) -> None:
        self.assertEqual(self.scope.find("Sion"), "abconf_sion.json")
        self.assertEqual(self.scope.find("sion"), "abconf_sion.json")
        self.assertEqual(self.scope.find("public"), "abconf_public.json")
        self.assertEqual(self.scope.find("abconf_sion.json"), "abconf_sion.json")
        self.assertEqual(self.scope.find("Sion_public"), "abconf_public.json")
        self.assertEqual(self.scope.find("默认"), "cmd_config.json")
        self.assertEqual(self.scope.find("default"), "cmd_config.json")
        self.assertIsNone(self.scope.find("不存在的配置"))
        self.assertIsNone(self.scope.find(""))

    def test_find_ambiguous_name_fails_closed(self) -> None:
        profiles = [
            {"id": "default", "name": "default", "path": "cmd_config.json", "plugin_set": ["*"]},
            {"id": "a", "name": "same", "path": "abconf_a.json", "plugin_set": ["*"]},
            {"id": "b", "name": "same", "path": "abconf_b.json", "plugin_set": ["*"]},
        ]
        scope = make_scope(FakeContext(FakeManager(profiles), {"": "default"}))
        self.assertIsNone(scope.find("same"))

    def test_plugin_enabled(self) -> None:
        self.assertTrue(self.scope.plugin_enabled("cmd_config.json"))
        self.assertTrue(self.scope.plugin_enabled("abconf_sion.json"))
        self.assertFalse(self.scope.plugin_enabled("abconf_public.json"))
        self.assertFalse(self.scope.plugin_enabled("abconf_disabled.json"))
        self.assertFalse(self.scope.plugin_enabled(""))
        self.assertFalse(self.scope.plugin_enabled("abconf_missing.json"))

    def test_owner_from_config(self) -> None:
        self.assertEqual(
            self.scope.owner_from_config({"bound_profile": "Sion"}, ""),
            ("abconf_sion.json", "bound"),
        )
        self.assertEqual(
            self.scope.owner_from_config({"bound_profile": "abconf_sion.json"}, ""),
            ("abconf_sion.json", "bound"),
        )
        self.assertEqual(
            self.scope.owner_from_config({"bound_profile": "不存在"}, ""),
            (None, "bound"),
        )
        self.assertEqual(
            self.scope.owner_from_config(
                {"event_target": "Sion:FriendMessage:1"}, ""
            ),
            ("abconf_sion.json", "target"),
        )
        self.assertEqual(
            self.scope.owner_from_config({}, "abconf_sion.json"),
            ("abconf_sion.json", "persisted"),
        )
        self.assertEqual(
            self.scope.owner_from_config({}, "abconf_missing.json"),
            (None, "none"),
        )
        self.assertEqual(self.scope.owner_from_config({}, ""), (None, "none"))

    def test_owner_bound_wins_over_target(self) -> None:
        self.assertEqual(
            self.scope.owner_from_config(
                {"bound_profile": "Sion_public", "event_target": "Sion:FriendMessage:1"},
                "",
            ),
            ("abconf_public.json", "bound"),
        )

    def test_is_auto_profile(self) -> None:
        for value in ("auto", "AUTO", "自动", "自动识别", " 自动判定 "):
            self.assertTrue(is_auto_profile(value), value)
        for value in ("", "Sion", "default", "自动配置x"):
            self.assertFalse(is_auto_profile(value), value)

    def test_owner_auto_ignores_persisted_and_uses_target(self) -> None:
        self.assertEqual(
            self.scope.owner_from_config(
                {"bound_profile": "auto", "event_target": "Sion:FriendMessage:1"},
                "abconf_public.json",
            ),
            ("abconf_sion.json", "target"),
        )

    def test_owner_auto_without_target_returns_auto(self) -> None:
        self.assertEqual(
            self.scope.owner_from_config(
                {"bound_profile": "自动"}, "abconf_public.json"
            ),
            (None, "auto"),
        )

    def test_available_profiles(self) -> None:
        available = self.scope.available()
        self.assertIn("Sion（abconf_sion.json）", available)
        self.assertIn("Sion_public（abconf_public.json）", available)
        self.assertIn("default（cmd_config.json）", available)

    def test_profile_choices(self) -> None:
        choices = self.scope.profile_choices()
        values = [value for value, _label, _sub in choices]
        self.assertIn("cmd_config.json", values)
        self.assertIn("abconf_sion.json", values)
        self.assertIn("abconf_public.json", values)
        labels = {value: label for value, label, _sub in choices}
        self.assertEqual(labels["abconf_sion.json"], "Sion")
        self.assertIn("默认配置文件", labels["cmd_config.json"])
        subtitles = {value: sub for value, _label, sub in choices}
        self.assertEqual(subtitles["abconf_sion.json"], "abconf_sion.json")

    def test_owner_target_unresolved(self) -> None:
        class BrokenManager(FakeManager):
            def get_conf_info(self, umo: str):
                return {}

        class BrokenContext(FakeContext):
            def get_config(self, umo=None):
                return None

        scope = ProfileScope(
            BrokenContext(BrokenManager(PROFILES), {}), PLUGIN
        )
        self.assertEqual(
            scope.owner_from_config({"event_target": "Sion:FriendMessage:1"}, ""),
            (None, "target"),
        )


class DecideAccessTests(unittest.TestCase):
    def setUp(self) -> None:
        self.scope = make_scope()

    def decide(self, cfg, persisted, umo, access_ok=always_ok, session_umo=None):
        return decide_access(
            self.scope, cfg, persisted, umo, access_ok, session_umo=session_umo
        )

    def test_claim_on_first_owner(self) -> None:
        decision = self.decide({}, "", "Sion:FriendMessage:1")
        self.assertTrue(decision.allowed)
        self.assertEqual(decision.owner, "abconf_sion.json")
        self.assertEqual(decision.claim, "abconf_sion.json")
        self.assertEqual(decision.reason, "claimed")

    def test_claim_skips_profile_without_plugin(self) -> None:
        decision = self.decide({}, "", "Sion:GroupMessage:2")
        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "profile_disabled")
        self.assertIsNone(decision.claim)

    def test_auto_reclaims_ignoring_persisted(self) -> None:
        decision = self.decide(
            {"bound_profile": "auto"},
            "abconf_public.json",
            "Sion:FriendMessage:1",
        )
        self.assertTrue(decision.allowed)
        self.assertEqual(decision.owner, "abconf_sion.json")
        self.assertEqual(decision.claim, "abconf_sion.json")
        self.assertEqual(decision.reason, "claimed")

    def test_owner_allows_only_own_profile(self) -> None:
        persisted = "abconf_sion.json"
        self.assertTrue(self.decide({}, persisted, "Sion:FriendMessage:1").allowed)
        other = self.decide({}, persisted, "Sion:GroupMessage:2")
        self.assertFalse(other.allowed)
        self.assertEqual(other.reason, "other_profile")
        self.assertEqual(other.owner, "abconf_sion.json")

    def test_owner_disabled_denies_even_own_profile(self) -> None:
        decision = self.decide({}, "abconf_public.json", "Sion:GroupMessage:2")
        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "owner_disabled")
        self.assertEqual(decision.owner, "abconf_public.json")

    def test_target_resolves_owner(self) -> None:
        cfg = {"event_target": "Sion:FriendMessage:1"}
        self.assertTrue(self.decide(cfg, "", "Sion:FriendMessage:1").allowed)
        denied = self.decide(cfg, "", "Sion:GroupMessage:2")
        self.assertFalse(denied.allowed)
        self.assertEqual(denied.reason, "other_profile")

    def test_bound_unresolved_fails_closed(self) -> None:
        decision = self.decide({"bound_profile": "不存在"}, "", "Sion:FriendMessage:1")
        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "bound_unresolved")
        self.assertIsNone(decision.owner)

    def test_access_scope_denies_before_claim(self) -> None:
        decision = self.decide(
            {"access_scope": "target", "event_target": ""},
            "",
            "Sion:GroupMessage:2",
            access_ok=target_only("Sion:FriendMessage:1"),
        )
        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "access_scope")
        self.assertIsNone(decision.claim)

    def test_access_scope_denies_inside_owner(self) -> None:
        cfg = {"access_scope": "target", "event_target": "Sion:FriendMessage:1"}
        decision = self.decide(
            cfg,
            "abconf_sion.json",
            "Sion:GroupMessage:4",
            access_ok=target_only("Sion:FriendMessage:1"),
        )
        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "access_scope")

    def test_profile_umo_used_for_owner_not_session_umo(self) -> None:
        decision = self.decide(
            {},
            "abconf_sion.json",
            "Sion:GroupMessage:2",
            session_umo="Sion:FriendMessage:1",
        )
        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "other_profile")

    def test_empty_umo_never_claims(self) -> None:
        decision = self.decide({}, "", "")
        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "no_umo")

    def test_legacy_without_profile_api(self) -> None:
        legacy = ProfileScope(object(), PLUGIN)
        decision = decide_access(legacy, {}, "", "anything", always_ok)
        self.assertTrue(decision.allowed)
        self.assertEqual(decision.reason, "legacy")
        denied = decide_access(
            legacy, {}, "", "anything", target_only("Sion:FriendMessage:1")
        )
        self.assertFalse(denied.allowed)
        self.assertEqual(denied.reason, "legacy")


class OwnerReadyAndTargetTests(unittest.TestCase):
    def setUp(self) -> None:
        self.scope = make_scope()

    def test_owner_ready(self) -> None:
        self.assertEqual(
            owner_ready(self.scope, {"event_target": "Sion:FriendMessage:1"}, ""),
            (True, "abconf_sion.json", "ready"),
        )
        self.assertEqual(owner_ready(self.scope, {}, ""), (False, None, "no_owner"))
        self.assertEqual(
            owner_ready(self.scope, {}, "abconf_public.json"),
            (False, "abconf_public.json", "owner_disabled"),
        )
        self.assertEqual(
            owner_ready(self.scope, {"bound_profile": "不存在"}, ""),
            (False, None, "bound_unresolved"),
        )
        self.assertTrue(owner_ready(ProfileScope(object(), PLUGIN), {}, "")[0])

    def test_target_allowed(self) -> None:
        cfg = {"event_target": "Sion:FriendMessage:1"}
        persisted = "abconf_sion.json"
        self.assertTrue(
            target_allowed(self.scope, cfg, persisted, "Sion:FriendMessage:1")
        )
        self.assertFalse(
            target_allowed(self.scope, cfg, persisted, "Sion:GroupMessage:2")
        )
        self.assertFalse(target_allowed(self.scope, cfg, persisted, ""))
        self.assertTrue(
            target_allowed(ProfileScope(object(), PLUGIN), cfg, persisted, "anything")
        )


class EventIdentityTests(unittest.TestCase):
    @staticmethod
    def event(unified, *, plugins=None, isolated=False, original=None):
        parts = unified.split(":", 2)
        return SimpleNamespace(
            unified_msg_origin=unified,
            plugins_name=plugins,
            message_obj=(
                SimpleNamespace(session_id=original) if original is not None else None
            ),
            session=SimpleNamespace(
                platform_id=parts[0],
                message_type=SimpleNamespace(value=parts[1]),
            ),
            _extras={"_session_isolated": isolated},
            get_extra=lambda key, default=None: (
                {("_session_isolated"): isolated}.get(key, default)
            ),
        )

    def test_profile_umo_non_isolated(self):
        event = self.event("Sion:GroupMessage:123")
        self.assertEqual(profile_umo(event), "Sion:GroupMessage:123")

    def test_profile_umo_isolated_restores_original(self):
        event = self.event(
            "Sion:GroupMessage:12345_891655174",
            isolated=True,
            original="891655174",
        )
        self.assertEqual(profile_umo(event), "Sion:GroupMessage:891655174")

    def test_profile_umo_isolated_without_original_falls_back(self):
        event = self.event(
            "Sion:GroupMessage:12345_891655174", isolated=True, original=None
        )
        self.assertEqual(
            profile_umo(event), "Sion:GroupMessage:12345_891655174"
        )

    def test_profile_umo_isolated_without_session_falls_back(self):
        event = self.event("Sion:GroupMessage:123", isolated=True, original="123")
        event.session = None
        self.assertEqual(profile_umo(event), "Sion:GroupMessage:123")

    def test_event_plugin_allowed(self):
        self.assertTrue(event_plugin_allowed(SimpleNamespace(plugins_name=None), PLUGIN))
        self.assertTrue(event_plugin_allowed(SimpleNamespace(plugins_name=["*"]), PLUGIN))
        self.assertTrue(
            event_plugin_allowed(SimpleNamespace(plugins_name=[PLUGIN]), PLUGIN)
        )
        self.assertFalse(
            event_plugin_allowed(SimpleNamespace(plugins_name=[]), PLUGIN)
        )
        self.assertFalse(
            event_plugin_allowed(SimpleNamespace(plugins_name=["other"]), PLUGIN)
        )
        self.assertTrue(event_plugin_allowed(SimpleNamespace(), PLUGIN))


class SessionUmoDecideTests(unittest.TestCase):
    def setUp(self) -> None:
        self.scope = make_scope()

    def test_access_uses_session_umo_not_profile_umo(self):
        seen: list[str] = []

        def access(umo: str) -> bool:
            seen.append(umo)
            return True

        decision = decide_access(
            self.scope,
            {},
            "abconf_sion.json",
            "Sion:FriendMessage:1",
            access,
            session_umo="Sion:GroupMessage:12345_891655174",
        )
        self.assertTrue(decision.allowed)
        self.assertEqual(seen, ["Sion:GroupMessage:12345_891655174"])

    def test_empty_session_denied_even_with_owner(self):
        decision = decide_access(
            self.scope,
            {},
            "abconf_sion.json",
            "Sion:FriendMessage:1",
            always_ok,
            session_umo="",
        )
        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "no_umo")

    def test_claim_uses_profile_umo(self):
        decision = decide_access(
            self.scope,
            {},
            "",
            "Sion:FriendMessage:1",
            always_ok,
            session_umo="Sion:FriendMessage:1",
        )
        self.assertTrue(decision.allowed)
        self.assertEqual(decision.claim, "abconf_sion.json")
        self.assertEqual(decision.reason, "claimed")


if __name__ == "__main__":
    unittest.main()