#!/usr/bin/env python

"""
Setup helper for zotero-mcp.

This script configures Claude Desktop or a standalone local config for Zotero MCP.
It intentionally preserves unknown keys in ~/.config/zotero-mcp/config.json so
older semantic-search settings can remain on disk without affecting new versions.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path


def find_executable() -> str | None:
    """Find the full path to the zotero-mcp executable."""
    exe_name = "zotero-mcp"
    if sys.platform == "win32":
        exe_name += ".exe"

    exe_path = shutil.which(exe_name)
    if exe_path:
        print(f"Found zotero-mcp in PATH at: {exe_path}")
        return exe_path

    potential_paths: list[Path] = []

    import site

    for site_path in site.getsitepackages():
        potential_paths.append(Path(site_path) / "bin" / exe_name)

    potential_paths.append(Path.home() / ".local" / "bin" / exe_name)

    if "VIRTUAL_ENV" in os.environ:
        potential_paths.append(Path(os.environ["VIRTUAL_ENV"]) / "bin" / exe_name)

    if sys.platform == "darwin":
        potential_paths.append(Path("/usr/local/bin") / exe_name)
        potential_paths.append(Path("/opt/homebrew/bin") / exe_name)

    for path in potential_paths:
        if path.exists() and os.access(path, os.X_OK):
            print(f"Found zotero-mcp at: {path}")
            return str(path)

    print("Warning: Could not find zotero-mcp executable.")
    print("Make sure zotero-mcp is installed and available in PATH.")
    return None


def find_claude_config() -> Path:
    """Find Claude Desktop config file path or return the platform default."""
    config_paths: list[Path] = []

    if sys.platform == "darwin":
        config_paths.append(
            Path.home()
            / "Library"
            / "Application Support"
            / "Claude"
            / "claude_desktop_config.json"
        )
        config_paths.append(
            Path.home()
            / "Library"
            / "Application Support"
            / "Claude Desktop"
            / "claude_desktop_config.json"
        )
    elif sys.platform == "win32":
        appdata = os.environ.get("APPDATA")
        if appdata:
            config_paths.append(Path(appdata) / "Claude" / "claude_desktop_config.json")
            config_paths.append(
                Path(appdata) / "Claude Desktop" / "claude_desktop_config.json"
            )
    else:
        config_home = os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))
        config_paths.append(Path(config_home) / "Claude" / "claude_desktop_config.json")
        config_paths.append(
            Path(config_home) / "Claude Desktop" / "claude_desktop_config.json"
        )

    for path in config_paths:
        if path.exists():
            print(f"Found Claude Desktop config at: {path}")
            return path

    if sys.platform == "darwin":
        default_path = (
            Path.home()
            / "Library"
            / "Application Support"
            / "Claude Desktop"
            / "claude_desktop_config.json"
        )
    elif sys.platform == "win32":
        default_path = (
            Path(os.environ.get("APPDATA", ""))
            / "Claude Desktop"
            / "claude_desktop_config.json"
        )
    else:
        config_home = os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))
        default_path = Path(config_home) / "Claude Desktop" / "claude_desktop_config.json"

    print(f"Claude Desktop config not found. Using default path: {default_path}")
    return default_path


def _load_json(path: Path) -> dict:
    if not path.exists():
        return {}

    try:
        with open(path, encoding="utf-8") as handle:
            payload = json.load(handle)
    except json.JSONDecodeError:
        print(f"Warning: {path} is not valid JSON. Recreating it.")
        return {}
    except Exception as exc:
        print(f"Warning: Could not read {path}: {exc}")
        return {}

    return payload if isinstance(payload, dict) else {}


def _write_json(path: Path, payload: dict) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
    return path


def build_client_env(*, no_claude: bool) -> dict[str, str]:
    env = {
        "ZOTERO_LOCAL": "true",
        "ZOTERO_LIBRARY_ID": "0",
        "ZOTERO_LIBRARY_TYPE": "user",
    }
    if no_claude:
        env["ZOTERO_NO_CLAUDE"] = "true"
    return env


def update_claude_config(config_path: Path, zotero_mcp_path: str) -> Path:
    """Update Claude Desktop config to add zotero-mcp."""
    config = _load_json(config_path)
    config.setdefault("mcpServers", {})
    if not isinstance(config["mcpServers"], dict):
        config["mcpServers"] = {}

    config["mcpServers"]["zotero"] = {
        "command": zotero_mcp_path,
        "env": build_client_env(no_claude=False),
    }

    _write_json(config_path, config)
    print(f"Successfully wrote Claude Desktop config to: {config_path}")
    return config_path


def write_standalone_config(*, no_claude: bool) -> Path:
    """Write ~/.config/zotero-mcp/config.json while preserving unknown keys."""
    cfg_path = Path.home() / ".config" / "zotero-mcp" / "config.json"
    config = _load_json(cfg_path)
    config["client_env"] = build_client_env(no_claude=no_claude)
    _write_json(cfg_path, config)
    return cfg_path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Configure zotero-mcp for local Zotero use")
    parser.add_argument(
        "--no-claude",
        action="store_true",
        help="Do not modify Claude Desktop config; write standalone config only",
    )
    parser.add_argument("--config-path", help="Path to Claude Desktop config file")
    return parser


def main(cli_args=None) -> int:
    """Main function to run the setup helper."""
    if cli_args is not None and hasattr(cli_args, "no_claude"):
        args = cli_args
        print("Using arguments passed from command line")
    else:
        args = build_parser().parse_args()
        print("Parsed arguments from command line")

    exe_path = find_executable()
    if not exe_path:
        print("Error: Could not find zotero-mcp executable.")
        return 1

    print(f"Using zotero-mcp at: {exe_path}")
    standalone_cfg_path = write_standalone_config(no_claude=bool(args.no_claude))

    if args.no_claude:
        print()
        print("Setup complete (standalone/local mode).")
        print(f"Config saved to: {standalone_cfg_path}")
        try:
            config = _load_json(standalone_cfg_path)
            print("Client environment (single-line JSON):")
            print(json.dumps(config.get("client_env", {}), separators=(",", ":")))
        except Exception:
            pass
        return 0

    if args.config_path:
        config_path = Path(args.config_path).expanduser()
        print(f"Using specified Claude Desktop config path: {config_path}")
    else:
        config_path = find_claude_config()

    update_claude_config(config_path, exe_path)

    print()
    print("Setup complete.")
    print("To use Zotero in Claude Desktop:")
    print("1. Restart Claude Desktop if it is running")
    print("2. In Claude, type: /tools zotero")
    print("3. Keep Zotero desktop running while using local-library tools")
    print()
    print(
        "A standalone config was also refreshed at ~/.config/zotero-mcp/config.json so local clients"
    )
    print("can reuse the same environment settings.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
