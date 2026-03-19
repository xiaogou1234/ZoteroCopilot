# -*- mode: python ; coding: utf-8 -*-

import os
import platform
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, copy_metadata

sys.path.insert(0, str(Path(SPECPATH).resolve()))

from helper_build_manifest import build_manifest, EXCLUDED_MODULES


project_root = Path(SPECPATH).resolve().parents[1]
src_dir = project_root / "src"
use_upx = platform.system() == "Windows"
target_arch = os.environ.get("PYINSTALLER_TARGET_ARCH") or None
product_name = os.environ.get("PYINSTALLER_PRODUCT_NAME", "zotero-mcp")

manifest = build_manifest(collect_all, copy_metadata)
datas = manifest["datas"]
binaries = manifest["binaries"]
hiddenimports = manifest["hiddenimports"]

a = Analysis(
    [str(src_dir / "zotero_mcp" / "helper_main.py")],
    pathex=[str(project_root), str(src_dir)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=list(EXCLUDED_MODULES),
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    name=product_name,
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    exclude_binaries=True,
    upx=use_upx,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    target_arch=target_arch,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=use_upx,
    upx_exclude=[],
    name=product_name,
)
