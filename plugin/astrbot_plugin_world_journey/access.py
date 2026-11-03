"""控制范围判断。

access_scope=target 时，只有「主动消息发给谁」（event_target）选中的
unified_msg_origin 才能使用插件；未配置目标则全部拒绝。
"""
from __future__ import annotations


def access_allowed(scope: object, target: object, umo: object) -> bool:
    if str(scope or "all").strip().lower() != "target":
        return True
    wanted = str(target or "").strip()
    if not wanted:
        return False
    actual = str(umo or "").strip()
    return bool(actual) and actual == wanted
