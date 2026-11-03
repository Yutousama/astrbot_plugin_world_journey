"""AstrBot 插件配置 → 引擎配置。

上游新增字段时，优先走 `extra_config`（一段 JSON 文本）覆盖；不需要改这里。
secrets（高德/生图 key）只写文件，不打印。
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

FIELD_MAP: dict[str, str] = {
    "home_city": "homeCity",
    "speed": "speed",
    "beat_gap": "beatGap",
    "rest_days": "restDays",
    "ask_before_depart": "askBeforeDepart",
    "max_trip_months": "maxTripMonths",
    "with_user": "withUser",
    "money_enabled": "moneyEnabled",
    "budget": "budget",
    "memory_dir": "memoryDir",
    "amap_key": "amapKey",
    "image_api": "imageApi",
    "image_style": "imageStyle",
    "image_key": "imageKey",
    "image_model": "imageModel",
    "selfie_enabled": "selfieEnabled",
    "selfie_reference": "selfieReference",
    "selfie_reference_path": "selfieReferencePath",
    "selfie_subject": "selfieSubject",
    "selfie_prompt": "selfiePrompt",
    "selfie_api": "selfieApi",
    "selfie_key": "selfieKey",
    "selfie_model": "selfieModel",
    "selfie_mode": "selfieMode",
    "selfie_native_url": "selfieNativeUrl",
    "selfie_image_field": "selfieImageField",
    "selfie_size": "selfieSize",
}

PLUGIN_DIR = Path(__file__).resolve().parent


def build_engine_config(config: dict[str, Any], base_dir: Path | None = None) -> dict[str, Any]:
    """返回写入 `engine-config.json` 的完整对象。"""
    engine: dict[str, Any] = {}
    for plugin_key, engine_key in FIELD_MAP.items():
        if plugin_key in config and config[plugin_key] is not None:
            engine[engine_key] = config[plugin_key]

    extra = config.get("extra_config") or ""
    if isinstance(extra, dict):
        extra_obj: Any = extra
    else:
        text = str(extra).strip()
        extra_obj = {}
        if text:
            extra_obj = json.loads(text)
    if extra_obj:
        if not isinstance(extra_obj, dict):
            raise ValueError("extra_config 必须是 JSON 对象")
        engine.update(extra_obj)

    # AstrBot 的 file 类型给的是插件根相对路径（files/<字段>/<文件>）；
    # sidecar 在插件根下运行，但显式转绝对路径更稳。
    if "selfieReference" in engine or "selfieReferencePath" in engine:
        refs = engine.get("selfieReference")
        items = refs if isinstance(refs, list) else [refs] if isinstance(refs, str) else []
        manual = engine.pop("selfieReferencePath", "")
        if isinstance(manual, str) and manual.strip():
            items.append(manual.strip())
        engine["selfieReference"] = _resolve_references(items, base_dir or PLUGIN_DIR)

    # 上游的拍照门槛看 imageApi；只配了 selfieApi 时也让它过闸。
    if not str(engine.get("imageApi") or "").strip() and str(engine.get("selfieApi") or "").strip():
        engine["imageApi"] = engine["selfieApi"]
    if not str(engine.get("imageKey") or "").strip() and str(engine.get("selfieKey") or "").strip():
        engine["imageKey"] = engine["selfieKey"]
    if not str(engine.get("imageModel") or "").strip() and str(engine.get("selfieModel") or "").strip():
        engine["imageModel"] = engine["selfieModel"]

    return {
        "engine": engine,
        "wrapper": {"offline": bool(config.get("offline", False))},
    }


def write_engine_config(path: Path, config: dict[str, Any]) -> None:
    """原子写；sidecar 自己按 mtime 热重载。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    # AstrBot 的 file 类型把上传文件放在插件数据目录（与 engine-config.json 同级）；
    # 所以这里用 path.parent 作为相对路径基准。
    payload = build_engine_config(config, path.parent)
    tmp = path.with_name(f"{path.name}.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def _resolve_references(value: Any, base_dir: Path) -> list[str]:
    items = value if isinstance(value, list) else [value] if isinstance(value, str) else []
    out: list[str] = []
    for item in items:
        if not isinstance(item, str) or not item.strip():
            continue
        text = item.strip()
        if text.startswith(("http://", "https://", "data:")) or Path(text).is_absolute():
            out.append(text)
        else:
            out.append(str((base_dir / text).resolve()))
    return out
