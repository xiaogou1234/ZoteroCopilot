"""
Centralized PyInstaller manifest for the public Zotero Copilot helper build.

This manifest intentionally excludes all semantic-search related dependencies so
the public helper stays smaller and easier to distribute.
"""

from __future__ import annotations

from typing import Callable


COLLECT_PACKAGES = (
    "fastmcp",
    "mcp",
    "setuptools",
    "jaraco.text",
    "pyzotero",
    "dotenv",
    "pydantic",
    "pydantic_core",
    "annotated_types",
    "typing_extensions",
    "requests",
    "certifi",
    "charset_normalizer",
    "idna",
    "urllib3",
    "bs4",
    "pdfminer",
)

COPY_METADATA = (
    "zotero-mcp-server",
    "setuptools",
    "fastmcp",
    "mcp",
    "pyzotero",
    "python-dotenv",
    "pydantic",
    "pydantic_core",
    "annotated-types",
    "typing-extensions",
    "requests",
    "certifi",
    "charset-normalizer",
    "idna",
    "urllib3",
    "beautifulsoup4",
    "pdfminer.six",
)

EXCLUDED_MODULES = (
    "markitdown",
    "pymupdf",
    "fitz",
    "ebooklib",
    "chromadb",
    "sentence_transformers",
    "transformers",
    "torch",
    "tiktoken",
    "openai",
    "google",
    "google.genai",
    "onnxruntime",
)

HIDDENIMPORTS = ()


def build_manifest(
    collect_all_fn: Callable[[str], tuple[list, list, list]],
    copy_metadata_fn: Callable[[str], list],
) -> dict[str, list]:
    datas: list = []
    binaries: list = []
    hiddenimports: list = list(HIDDENIMPORTS)

    for package_name in COLLECT_PACKAGES:
        try:
            collected = collect_all_fn(package_name)
        except Exception:
            continue
        datas += collected[0]
        binaries += collected[1]
        hiddenimports += collected[2]

    for metadata_name in COPY_METADATA:
        try:
            datas += copy_metadata_fn(metadata_name)
        except Exception:
            continue

    deduped_hiddenimports = list(dict.fromkeys(hiddenimports))
    return {
        "datas": datas,
        "binaries": binaries,
        "hiddenimports": deduped_hiddenimports,
    }
