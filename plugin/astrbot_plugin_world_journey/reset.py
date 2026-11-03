"""重置旅行数据时用的文件清理。

只清旅行自己的文件，不碰同步盘里的其它东西：
- 月文件日记：`2026-11.md`、`2026-11-02.md`、`2026-11-电脑名.md`
- 旅行记忆：`travel-memory.json`、`travel-memory-笔记本.json`
- `_bak/legacy/` 下的旧日记
"""
from __future__ import annotations

import contextlib
import re
from pathlib import Path

DIARY_FILE = re.compile(r"^\d{4}-\d{2}(?:-\d{2})?(?:[-_].*)?\.md$")
MEMORY_FILE = re.compile(r"^travel-memory.*\.json$")


def clear_memory_dir(directory: Path, engine_dir: Path) -> None:
    if not directory.exists():
        return
    if is_within(directory, engine_dir):
        # 默认 diary 就在 engine 里，已经被整体删掉了。
        return
    for path in directory.rglob("*"):
        if is_within(path, engine_dir):
            continue
        if path.is_file() and (DIARY_FILE.match(path.name) or MEMORY_FILE.match(path.name)):
            with contextlib.suppress(OSError):
                path.unlink()
    # 删掉因此空掉的 _bak/legacy；不碰非空目录，也不碰用户自己的空目录。
    for path in sorted(directory.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        if path.is_dir() and "_bak" in path.parts and not is_within(path, engine_dir):
            with contextlib.suppress(OSError):
                path.rmdir()


def is_within(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except (OSError, ValueError):
        return False
