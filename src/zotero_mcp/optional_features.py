"""
Helpers for optional dependency loading with user-facing install hints.
"""

from __future__ import annotations


SEMANTIC_SEARCH_INSTALL_HINT = (
    "Semantic search dependencies are not installed. "
    "Install them with: pip install \"zotero-mcp-server[semantic]\""
)


def load_semantic_search_factory():
    """Import semantic search lazily so lightweight installs can skip heavy dependencies."""
    try:
        from zotero_mcp.semantic_search import create_semantic_search

        return create_semantic_search
    except ModuleNotFoundError as error:
        missing = error.name or "unknown dependency"
        raise RuntimeError(f"{SEMANTIC_SEARCH_INSTALL_HINT} (missing: {missing})") from error
