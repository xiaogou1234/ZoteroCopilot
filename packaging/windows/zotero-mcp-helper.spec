# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

from PyInstaller.utils.hooks import collect_all, copy_metadata

project_root = Path(SPECPATH).resolve().parents[1]
src_dir = project_root / "src"

datas = []
binaries = []
hiddenimports = []

for package_name in (
    "fastmcp",
    "mcp",
    "setuptools",
    "jaraco.text",
    "pyzotero",
    "markitdown",
    "dotenv",
    "pydantic",
    "requests",
    "fitz",
    "pymupdf",
    "ebooklib",
    "certifi",
    "chromadb",
    "sentence_transformers",
    "transformers",
    "torch",
    "tiktoken",
    "openai",
    "google.genai",
):
    try:
        collected = collect_all(package_name)
        datas += collected[0]
        binaries += collected[1]
        hiddenimports += collected[2]
    except Exception:
        pass

for metadata_name in (
    "zotero-mcp-server",
    "setuptools",
    "fastmcp",
    "mcp",
    "pyzotero",
    "markitdown",
    "python-dotenv",
    "pydantic",
    "requests",
    "PyMuPDF",
    "ebooklib",
    "chromadb",
    "sentence-transformers",
    "transformers",
    "torch",
    "tiktoken",
    "openai",
    "google-genai",
):
    try:
        datas += copy_metadata(metadata_name)
    except Exception:
        pass

try:
    import jaraco.text as jaraco_text
    jaraco_text_dir = Path(jaraco_text.__file__).resolve().parent
    lorem_ipsum = jaraco_text_dir / "Lorem ipsum.txt"
    if lorem_ipsum.exists():
        datas.append((str(lorem_ipsum), "jaraco/text"))
except Exception:
    pass

a = Analysis(
    [str(src_dir / "zotero_mcp" / "helper_main.py")],
    pathex=[str(project_root), str(src_dir)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    name="zotero-mcp",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    exclude_binaries=True,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="zotero-mcp",
)
