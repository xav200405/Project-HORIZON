#!/usr/bin/env python3
"""Build the TP-ARC RMS Raspberry Pi app package."""
from __future__ import annotations

import re
import tarfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
APP_DIR = ROOT / "app"
SOURCE_LAUNCHER = ROOT / "TP_ARC_RMS_single.py"
LAUNCHER = APP_DIR / "TP_ARC_RMS_single.py"
DIST_DIR = ROOT / "dist"
PACKAGE_VERSION = "2026.06-rev01.18"


def app_version() -> str:
    text = LAUNCHER.read_text(encoding="utf-8")
    match = re.search(r'APP_VERSION = "([^"]+)"', text)
    return match.group(1) if match else "unknown"


def main() -> None:
    if not SOURCE_LAUNCHER.exists():
        raise SystemExit(f"Missing {SOURCE_LAUNCHER}")
    if not LAUNCHER.exists() or LAUNCHER.read_bytes() != SOURCE_LAUNCHER.read_bytes():
        LAUNCHER.write_bytes(SOURCE_LAUNCHER.read_bytes())
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    package = DIST_DIR / f"tparc-rms-pi-app-{PACKAGE_VERSION}.tar.gz"
    with tarfile.open(package, "w:gz") as tar:
        for path in sorted(APP_DIR.rglob("*")):
            if path.is_dir() or "__pycache__" in path.parts or path.suffix == ".pyc":
                continue
            arcname = Path("tparc-rms-pi-app") / path.relative_to(APP_DIR)
            info = tar.gettarinfo(str(path), str(arcname))
            if path.name in {"install.sh", "update.sh", "github_update.py", "uninstall.sh", "uninstall_all.sh", "TP_ARC_RMS_single.py"}:
                info.mode = 0o755
            with path.open("rb") as handle:
                tar.addfile(info, handle)
    print(package)


if __name__ == "__main__":
    main()
