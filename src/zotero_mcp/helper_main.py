"""
Lightweight local helper entry point for Zotero desktop plugin integrations.
"""

from __future__ import annotations

import argparse
import os

os.environ.setdefault("FASTMCP_CHECK_FOR_UPDATES", "off")
os.environ.setdefault("FASTMCP_SHOW_SERVER_BANNER", "false")
os.environ.setdefault("ZOTERO_NO_CLAUDE", "true")

from zotero_mcp._version import __version__
from zotero_mcp.helper_bridge_proxy import (
    configure_helper_bridge_proxy,
    get_helper_bridge_base_url,
)
from zotero_mcp.runtime_env import apply_local_helper_defaults, setup_zotero_environment
from zotero_mcp.server import mcp

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000


def _resolve_port(explicit_port: int | None) -> int:
    if explicit_port:
        return explicit_port

    env_port = os.getenv("ZOTERO_DESKTOP_MCP_PORT", "")
    try:
        port = int(env_port)
    except (TypeError, ValueError):
        port = DEFAULT_PORT

    if 1 <= port <= 65535:
        return port
    return DEFAULT_PORT


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Lightweight local Zotero MCP helper for desktop plugin integrations"
    )
    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    serve_parser = subparsers.add_parser("serve", help="Run the local MCP helper")
    serve_parser.add_argument(
        "--transport",
        choices=["streamable-http", "stdio"],
        default="streamable-http",
        help="Transport to use (default: streamable-http)",
    )
    serve_parser.add_argument(
        "--host",
        default=DEFAULT_HOST,
        help=f"Host to bind to for HTTP transport (default: {DEFAULT_HOST})",
    )
    serve_parser.add_argument(
        "--port",
        type=int,
        default=None,
        help=f"Port to bind to for HTTP transport (default: {DEFAULT_PORT})",
    )

    subparsers.add_parser("version", help="Print version information")
    return parser

def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)

    if not args.command:
        args.command = "serve"
        args.transport = "streamable-http"
        args.host = DEFAULT_HOST
        args.port = None

    if args.command == "version":
        print(f"Zotero MCP Helper v{__version__}")
        return

    apply_local_helper_defaults()
    setup_zotero_environment()

    if args.transport == "stdio":
        mcp.run(transport="stdio")
        return

    resolved_port = _resolve_port(args.port)
    os.environ["ZOTERO_DESKTOP_MCP_PORT"] = str(resolved_port)
    os.environ.setdefault("ZOTERO_DESKTOP_BRIDGE_URL", get_helper_bridge_base_url())
    configure_helper_bridge_proxy(mcp)

    mcp.run(transport="streamable-http", host=args.host, port=resolved_port)


if __name__ == "__main__":
    main()
