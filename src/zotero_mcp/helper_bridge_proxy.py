"""Expose the Zotero desktop bridge behind the helper's public HTTP port."""

from __future__ import annotations

import asyncio
import os

import requests
from fastmcp import FastMCP
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

DEFAULT_HELPER_PORT = 8000
DEFAULT_ZOTERO_BRIDGE_PORT = 23119
DEFAULT_BRIDGE_PROXY_TIMEOUT = 120.0
PROXY_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
FORWARDED_REQUEST_HEADERS = {"authorization", "content-type", "accept"}

_proxy_registered = False


def _read_port(raw_value: str | None, fallback: int) -> int:
    try:
        port = int(str(raw_value or "").strip())
    except (TypeError, ValueError):
        return fallback

    if 1 <= port <= 65535:
        return port
    return fallback


def get_helper_bridge_base_url() -> str:
    """Return the helper-facing bridge URL that MCP clients should use."""
    port = _read_port(os.getenv("ZOTERO_DESKTOP_MCP_PORT"), DEFAULT_HELPER_PORT)
    return f"http://127.0.0.1:{port}/zero-mcp"


def get_bridge_upstream_base_url() -> str:
    """Return the Zotero-hosted bridge URL that the helper should proxy to."""
    explicit_url = os.getenv("ZOTERO_DESKTOP_BRIDGE_UPSTREAM_URL", "").strip()
    if explicit_url:
        return explicit_url.rstrip("/")

    port = _read_port(os.getenv("ZOTERO_LOCAL_PORT"), DEFAULT_ZOTERO_BRIDGE_PORT)
    return f"http://127.0.0.1:{port}/zero-mcp"


def _build_upstream_url(bridge_path: str, query_string: str) -> str:
    base_url = get_bridge_upstream_base_url().rstrip("/")
    if bridge_path:
        base_url = f"{base_url}/{bridge_path.lstrip('/')}"
    if query_string:
        return f"{base_url}?{query_string}"
    return base_url


def _bridge_proxy_timeout_seconds(bridge_path: str) -> float:
    raw_timeout = os.getenv("ZOTERO_DESKTOP_BRIDGE_PROXY_TIMEOUT", "").strip()
    if raw_timeout:
        try:
            return float(raw_timeout)
        except ValueError:
            pass

    normalized_path = bridge_path.strip("/").lower()
    if normalized_path.startswith("items/import-identifier"):
        return DEFAULT_BRIDGE_PROXY_TIMEOUT
    return 30.0


async def _forward_bridge_request(request: Request, bridge_path: str = "") -> Response:
    helper_base_url = get_helper_bridge_base_url().rstrip("/")
    upstream_base_url = get_bridge_upstream_base_url().rstrip("/")

    if helper_base_url == upstream_base_url:
        return JSONResponse(
            {
                "ok": False,
                "error": {
                    "code": "BRIDGE_PROXY_MISCONFIGURED",
                    "message": (
                        "Helper bridge proxy upstream points back to the helper itself. "
                        "Set ZOTERO_DESKTOP_BRIDGE_UPSTREAM_URL to the Zotero internal bridge."
                    ),
                },
            },
            status_code=500,
        )

    body = await request.body()
    query_string = request.url.query
    upstream_url = _build_upstream_url(bridge_path, query_string)
    forwarded_headers = {
        name: value
        for name, value in request.headers.items()
        if name.lower() in FORWARDED_REQUEST_HEADERS
    }
    timeout = _bridge_proxy_timeout_seconds(bridge_path)

    try:
        upstream_response = await asyncio.to_thread(
            requests.request,
            request.method,
            upstream_url,
            data=body or None,
            headers=forwarded_headers or None,
            timeout=timeout,
        )
    except requests.RequestException as exc:
        return JSONResponse(
            {
                "ok": False,
                "error": {
                    "code": "BRIDGE_UPSTREAM_UNAVAILABLE",
                    "message": f"Could not reach Zotero desktop bridge at {upstream_url}: {exc}",
                },
            },
            status_code=502,
        )

    response_headers: dict[str, str] = {}
    content_type = upstream_response.headers.get("Content-Type")
    if content_type:
        response_headers["Content-Type"] = content_type

    return Response(
        content=upstream_response.content,
        status_code=upstream_response.status_code,
        headers=response_headers,
    )


def configure_helper_bridge_proxy(mcp: FastMCP) -> None:
    """Register helper-side HTTP routes that proxy the desktop bridge."""
    global _proxy_registered
    if _proxy_registered:
        return

    @mcp.custom_route("/zero-mcp", methods=PROXY_METHODS, include_in_schema=False)
    async def bridge_proxy_root(request: Request) -> Response:
        return await _forward_bridge_request(request)

    @mcp.custom_route("/zero-mcp/{bridge_path:path}", methods=PROXY_METHODS, include_in_schema=False)
    async def bridge_proxy_with_path(request: Request) -> Response:
        bridge_path = str(request.path_params.get("bridge_path", ""))
        return await _forward_bridge_request(request, bridge_path)

    _proxy_registered = True
