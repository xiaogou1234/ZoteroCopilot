"""
Command-line interface for Zotero MCP server.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys

from zotero_mcp.runtime_env import (
    is_truthy_env,
    load_claude_desktop_env_vars,
    load_standalone_env_vars,
    setup_zotero_environment,
)
from zotero_mcp.server import mcp

DISTRIBUTION_NAME = "zoterocopilot-server"
LEGACY_DISTRIBUTION_NAMES = ("zotero-mcp-server",)
PACKAGE_DETECTION_TOKENS = (DISTRIBUTION_NAME, *LEGACY_DISTRIBUTION_NAMES, "zotero-mcp")


def obfuscate_sensitive_value(value: str | None, keep_chars: int = 4) -> str | None:
    """Obfuscate sensitive values by showing only the first few characters."""
    if not value or not isinstance(value, str):
        return value
    if len(value) <= keep_chars:
        return "*" * len(value)
    return value[:keep_chars] + "*" * (len(value) - keep_chars)


def obfuscate_config_for_display(config: dict[str, str] | object) -> dict[str, str] | object:
    """Create a copy of config with sensitive values obfuscated."""
    if not isinstance(config, dict):
        return config

    obfuscated = config.copy()
    sensitive_keys = ["API_KEY", "LIBRARY_ID", "ZOTERO_DESKTOP_BRIDGE_TOKEN"]

    for key in list(obfuscated):
        if any(fragment in key for fragment in sensitive_keys):
            obfuscated[key] = obfuscate_sensitive_value(str(obfuscated[key]))

    return obfuscated


def detect_installation_method() -> str:
    """Best-effort detection of the current installation method."""
    try:
        result = subprocess.run(
            ["uv", "tool", "list"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if any(token in result.stdout for token in PACKAGE_DETECTION_TOKENS):
            return "uv tool"
    except (subprocess.TimeoutExpired, subprocess.SubprocessError, FileNotFoundError):
        pass

    for package_name in (DISTRIBUTION_NAME, *LEGACY_DISTRIBUTION_NAMES):
        try:
            result = subprocess.run(
                [sys.executable, "-m", "pip", "show", package_name],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode == 0:
                return "pip"
        except (subprocess.TimeoutExpired, subprocess.SubprocessError, FileNotFoundError):
            pass

    return "unknown"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Zotero Model Context Protocol server")
    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    server_parser = subparsers.add_parser("serve", help="Run the MCP server")
    server_parser.add_argument(
        "--transport",
        choices=["stdio", "streamable-http", "sse"],
        default="stdio",
        help="Transport to use (default: stdio)",
    )
    server_parser.add_argument(
        "--host",
        default="localhost",
        help="Host to bind to for network transports (default: localhost)",
    )
    server_parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Port to bind to for network transports (default: 8000)",
    )

    setup_parser = subparsers.add_parser("setup", help="Configure zotero-mcp for local Zotero use")
    setup_parser.add_argument(
        "--no-claude",
        action="store_true",
        help="Skip Claude Desktop config; write standalone local config instead",
    )
    setup_parser.add_argument("--config-path", help="Path to Claude Desktop config file")

    update_parser = subparsers.add_parser("update", help="Update zotero-mcp to the latest version")
    update_parser.add_argument(
        "--check-only",
        action="store_true",
        help="Only check for updates without installing",
    )
    update_parser.add_argument(
        "--force",
        action="store_true",
        help="Force update even if already up to date",
    )
    update_parser.add_argument(
        "--method",
        choices=["pip", "uv", "conda", "pipx"],
        help="Override auto-detected installation method",
    )

    subparsers.add_parser("version", help="Print version information")
    subparsers.add_parser(
        "setup-info",
        help="Show installation path and configuration info for MCP clients",
    )

    return parser


def print_setup_info() -> int:
    """Print the current CLI/configuration status used by MCP clients."""
    setup_zotero_environment()

    executable_path = shutil.which("zotero-mcp")
    if not executable_path:
        executable_path = sys.executable + " -m zotero_mcp"

    no_claude = is_truthy_env(os.environ.get("ZOTERO_NO_CLAUDE"))
    standalone_env_vars = load_standalone_env_vars()
    claude_env_vars = {} if no_claude else load_claude_desktop_env_vars()
    display_env = (
        standalone_env_vars
        if (no_claude or standalone_env_vars)
        else (claude_env_vars or {"ZOTERO_LOCAL": "true"})
    )

    print("=== Zotero MCP Setup Information ===")
    print()
    print("[Installation Details]")
    print(f"  Command path: {executable_path}")
    print(f"  Python path: {sys.executable}")
    print(f"  Installation method: {detect_installation_method()}")
    print()
    print("[MCP Client Configuration]")
    print(f"  Command: {executable_path}")
    print("  Arguments: [] (empty)")
    print(
        "  Environment (single-line): "
        + json.dumps(obfuscate_config_for_display(display_env), separators=(",", ":"))
    )
    print("  Note: Shell variables may still override CLI behavior.")
    print(f"  Claude integration: {'disabled' if no_claude else 'enabled'}")
    print()
    print("[Standalone Config]")
    if standalone_env_vars:
        print("  Status: configured")
        print("  Path: ~/.config/zotero-mcp/config.json")
    else:
        print("  Status: not configured")

    if not no_claude:
        print()
        print("For Claude Desktop (claude_desktop_config.json):")
        config_snippet = {
            "mcpServers": {
                "zotero": {
                    "command": executable_path,
                    "env": obfuscate_config_for_display(display_env),
                }
            }
        }
        print(json.dumps(config_snippet, indent=2))

    return 0


def run_update(args: argparse.Namespace) -> int:
    from zotero_mcp.updater import update_zotero_mcp

    print("Checking for updates...")
    result = update_zotero_mcp(
        check_only=args.check_only,
        force=args.force,
        method=args.method,
    )

    print("\n" + "=" * 50)
    print("UPDATE RESULTS")
    print("=" * 50)

    if args.check_only:
        print(f"Current version: {result.get('current_version', 'Unknown')}")
        print(f"Latest version: {result.get('latest_version', 'Unknown')}")
        print(f"Update needed: {result.get('needs_update', False)}")
        print(f"Status: {result.get('message', 'Unknown')}")
        return 0

    if result.get("success"):
        print("Update completed successfully.")
        print(
            "Version: "
            + f"{result.get('current_version', 'Unknown')} -> {result.get('latest_version', 'Unknown')}"
        )
        print(f"Method: {result.get('method', 'Unknown')}")
        print(f"Message: {result.get('message', '')}")
        print()
        print("Next steps:")
        print("- All existing configuration files were preserved.")
        print("- Restart Claude Desktop if it is running.")
        print("- Run 'zotero-mcp version' to verify the update.")
        return 0

    print("Update failed.")
    print(f"Error: {result.get('message', 'Unknown error')}")
    if backup_dir := result.get("backup_dir"):
        print(f"Backup created at: {backup_dir}")
        print("You can manually restore configuration files if needed.")
    return 1


def run_server(args: argparse.Namespace) -> int:
    transport = getattr(args, "transport", "stdio")
    setup_zotero_environment()

    if transport == "stdio":
        mcp.run(transport="stdio")
        return 0

    host = getattr(args, "host", "localhost")
    port = getattr(args, "port", 8000)
    if transport == "streamable-http":
        mcp.run(transport="streamable-http", host=host, port=port)
        return 0

    import warnings

    warnings.warn(
        (
            "The SSE transport is deprecated and may be removed in a future version. "
            "New applications should use Streamable HTTP transport instead."
        ),
        UserWarning,
    )
    mcp.run(transport="sse", host=host, port=port)
    return 0


def main() -> None:
    """Main entry point for the CLI."""
    parser = build_parser()
    args = parser.parse_args()

    if not args.command:
        args.command = "serve"
        args.transport = "stdio"

    if args.command == "version":
        from zotero_mcp._version import __version__

        print(f"Zotero MCP v{__version__}")
        raise SystemExit(0)

    if args.command == "setup-info":
        raise SystemExit(print_setup_info())

    if args.command == "setup":
        from zotero_mcp.setup_helper import main as setup_main

        raise SystemExit(setup_main(args))

    if args.command == "update":
        raise SystemExit(run_update(args))

    if args.command == "serve":
        raise SystemExit(run_server(args))

    parser.error(f"Unsupported command: {args.command}")


if __name__ == "__main__":
    main()
