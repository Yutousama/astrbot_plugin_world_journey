"""插件侧默认值（与 adapter/selfie.ts 的 DEFAULT_PROMPT 保持同步）。"""
from __future__ import annotations

DEFAULT_SELFIE_PROMPT = (
    "一张自拍照片：{subject}在画面里，手机前置镜头近距离自拍，脸和上半身清晰，眼睛看着镜头，表情自然。\n"
    "背景：{scene}\n"
    "参考图是{subject}的长相参考：保持五官、脸型、发型、肤色、年龄和气质一致；不要换脸，不要变成陌生人，不要照搬参考图的背景和衣服。\n"
    "真实手机自拍质感，自然光，轻微手持感；画面里只有{subject}一个人，没有文字、水印、边框。"
)
