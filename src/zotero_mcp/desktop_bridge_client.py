"""HTTP client for the Zotero desktop mutation bridge."""

from __future__ import annotations

from dataclasses import dataclass
import os
from typing import Any

import requests

from zotero_mcp.zotero_profile import discover_active_bridge_secret


def _read_port(raw_value: str | None, fallback: int) -> int:
    try:
        port = int(str(raw_value or "").strip())
    except (TypeError, ValueError):
        return fallback

    if 1 <= port <= 65535:
        return port
    return fallback


def _default_bridge_base_url() -> str:
    helper_port = os.getenv("ZOTERO_DESKTOP_MCP_PORT")
    if helper_port:
        port = _read_port(helper_port, 8000)
        return f"http://127.0.0.1:{port}/zero-mcp"

    port = _read_port(os.getenv("ZOTERO_LOCAL_PORT"), 23119)
    return f"http://127.0.0.1:{port}/zero-mcp"


class DesktopBridgeError(RuntimeError):
    """Raised when the Zotero desktop mutation bridge returns an error."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.payload = payload or {}

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "statusCode": self.status_code,
            "details": self.payload or None,
        }


@dataclass
class DesktopBridgeClient:
    """Thin JSON-over-HTTP client for the local Zotero mutation bridge."""

    base_url: str
    token: str | None = None
    timeout: float = 120.0
    session: Any = None

    @classmethod
    def from_env(cls) -> "DesktopBridgeClient":
        timeout_raw = os.getenv("ZOTERO_DESKTOP_BRIDGE_TIMEOUT", "120")
        try:
            timeout = float(timeout_raw)
        except ValueError:
            timeout = 120.0

        return cls(
            base_url=os.getenv("ZOTERO_DESKTOP_BRIDGE_URL", _default_bridge_base_url()),
            token=os.getenv("ZOTERO_DESKTOP_BRIDGE_TOKEN") or discover_active_bridge_secret(),
            timeout=timeout,
        )

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    def _build_url(self, path: str) -> str:
        return f"{self.base_url.rstrip('/')}/{path.lstrip('/')}"

    def _decode_response(self, response: requests.Response) -> dict[str, Any]:
        if not response.content:
            return {}

        try:
            payload = response.json()
        except ValueError:
            payload = {"raw": response.text}

        if isinstance(payload, dict):
            return payload
        return {"data": payload}

    def _raise_for_bridge_error(
        self,
        response: requests.Response,
        payload: dict[str, Any],
    ) -> None:
        error = payload.get("error", {})
        if isinstance(error, dict):
            code = error.get("code") or f"HTTP_{response.status_code}"
            message = error.get("message") or response.text or response.reason
        else:
            code = f"HTTP_{response.status_code}"
            message = response.text or response.reason

        raise DesktopBridgeError(
            code,
            message,
            status_code=response.status_code,
            payload=payload,
        )

    def _post(self, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        requester = self.session or requests
        url = self._build_url(path)
        body = payload or {}

        response = self._send_request(requester, url, body)
        response_payload = self._decode_response(response)

        if response.status_code == 401:
            discovered_token = discover_active_bridge_secret()
            if discovered_token and discovered_token != self.token:
                self.token = discovered_token
                response = self._send_request(requester, url, body)
                response_payload = self._decode_response(response)

        if response.status_code >= 400:
            self._raise_for_bridge_error(response, response_payload)

        if response_payload.get("ok") is False:
            self._raise_for_bridge_error(response, response_payload)

        response_payload.setdefault("ok", True)
        return response_payload

    def _send_request(
        self,
        requester: Any,
        url: str,
        body: dict[str, Any],
    ) -> requests.Response:
        try:
            return requester.post(
                url,
                json=body,
                headers=self._headers(),
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise DesktopBridgeError(
                "BRIDGE_UNAVAILABLE",
                f"Could not reach Zotero desktop bridge at {url}: {exc}",
            ) from exc

    def capabilities(self, *, verbose: bool = False) -> dict[str, Any]:
        return self._post("health", {"verbose": verbose})

    def resolve_collection_path(self, *, collection_path: str) -> dict[str, Any]:
        return self._post("collections/resolve", {"collectionPath": collection_path})

    def create_collection(self, **payload: Any) -> dict[str, Any]:
        return self._post("collections/create", payload)

    def delete_collection(self, **payload: Any) -> dict[str, Any]:
        return self._post("collections/delete", payload)

    def batch_create_collections(self, **payload: Any) -> dict[str, Any]:
        return self._post("collections/batch-create", payload)

    def batch_delete_collections(self, **payload: Any) -> dict[str, Any]:
        return self._post("collections/batch-delete", payload)

    def create_collection_note(self, **payload: Any) -> dict[str, Any]:
        return self._post("notes/create-collection-note", payload)

    def create_child_note(self, **payload: Any) -> dict[str, Any]:
        return self._post("notes/create-child-note", payload)

    def import_pdf_to_collection(self, **payload: Any) -> dict[str, Any]:
        return self._post("items/import-pdf", payload)

    def import_identifier_to_collection(self, **payload: Any) -> dict[str, Any]:
        return self._post("items/import-identifier", payload)

    def import_bibtex_to_collection(self, **payload: Any) -> dict[str, Any]:
        return self._post("items/import-bibtex", payload)

    def batch_import_pdfs_to_collection(self, **payload: Any) -> dict[str, Any]:
        return self._post("items/batch-import-pdf", payload)

    def move_items_between_collections(self, **payload: Any) -> dict[str, Any]:
        return self._post("items/move-between-collections", payload)

    def remove_item_from_collection(self, **payload: Any) -> dict[str, Any]:
        return self._post("items/remove-from-collection", payload)

    def delete_item(self, **payload: Any) -> dict[str, Any]:
        return self._post("items/delete", payload)

    def batch_update_tags(self, **payload: Any) -> dict[str, Any]:
        return self._post("items/batch-update-tags", payload)
