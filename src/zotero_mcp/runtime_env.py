"""
Shared environment bootstrap helpers for CLI entry points.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from zotero_mcp.zotero_profile import (
    discover_active_bridge_secret,
    discover_active_local_mcp_port,
    discover_active_zotero_db_path,
)

TRUTHY_ENV_VALUES = {"1", "true", "yes"}

LOCAL_CLIENT_FALLBACK_ENV_VARS = {
    "ZOTERO_LOCAL": "true",
    "ZOTERO_LIBRARY_ID": "0",
}

LOCAL_HELPER_ENV_VARS = {
    "ZOTERO_NO_CLAUDE": "true",
    "ZOTERO_LOCAL": "true",
    "ZOTERO_LIBRARY_ID": "0",
    "ZOTERO_LIBRARY_TYPE": "user",
}


def is_truthy_env(value: str | None) -> bool:
    return str(value or "").lower() in TRUTHY_ENV_VALUES


def load_claude_desktop_env_vars() -> dict[str, str]:
    """Load Zotero environment variables from Claude Desktop config unless disabled."""
    if is_truthy_env(os.environ.get("ZOTERO_NO_CLAUDE")):
        return {}

    from zotero_mcp.setup_helper import find_claude_config

    try:
        config_path = find_claude_config()
        if not config_path or not config_path.exists():
            return {}

        with open(config_path, encoding="utf-8") as handle:
            config = json.load(handle)

        mcp_servers = config.get("mcpServers", {})
        zotero_config = mcp_servers.get("zotero", {})
        env_vars = zotero_config.get("env", {})
        return env_vars if isinstance(env_vars, dict) else {}
    except Exception:
        return {}


def load_standalone_env_vars() -> dict[str, str]:
    """Load environment variables from standalone config (~/.config/zotero-mcp/config.json)."""
    try:
        config_path = Path.home() / ".config" / "zotero-mcp" / "config.json"
        if not config_path.exists():
            return {}

        with open(config_path, encoding="utf-8") as handle:
            config = json.load(handle)

        env_vars = config.get("client_env", {})
        return env_vars if isinstance(env_vars, dict) else {}
    except Exception:
        return {}


def apply_environment_variables(env_vars: dict[str, str]) -> None:
    """Apply environment variables to current process without overriding explicit values."""
    for key, value in env_vars.items():
        if key not in os.environ:
            os.environ[key] = str(value)


def apply_local_helper_defaults() -> None:
    """Force local-only defaults used by the packaged desktop helper."""
    os.environ.update(LOCAL_HELPER_ENV_VARS)


def load_active_profile_env_vars() -> dict[str, str]:
    """Load bridge and database settings from the currently active Zotero profile."""
    env_vars: dict[str, str] = {}

    bridge_secret = discover_active_bridge_secret()
    if bridge_secret:
        env_vars["ZOTERO_DESKTOP_BRIDGE_TOKEN"] = bridge_secret

    db_path = discover_active_zotero_db_path()
    if db_path:
        env_vars["ZOTERO_LOCAL_DB_PATH"] = db_path

    local_mcp_port = discover_active_local_mcp_port()
    if local_mcp_port:
        env_vars["ZOTERO_DESKTOP_MCP_PORT"] = str(local_mcp_port)

    return env_vars


def setup_zotero_environment() -> None:
    """Populate the current process with any saved Zotero configuration."""
    standalone_env_vars = load_standalone_env_vars()
    apply_environment_variables(standalone_env_vars)

    no_claude = is_truthy_env(os.environ.get("ZOTERO_NO_CLAUDE"))
    if not no_claude:
        claude_env_vars = load_claude_desktop_env_vars()
        apply_environment_variables(claude_env_vars)

    active_profile_env_vars = load_active_profile_env_vars()
    apply_environment_variables(active_profile_env_vars)

    apply_environment_variables(LOCAL_CLIENT_FALLBACK_ENV_VARS)
