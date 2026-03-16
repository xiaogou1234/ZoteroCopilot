import requests

from zotero_mcp.desktop_bridge_client import DesktopBridgeClient, DesktopBridgeError


class FakeResponse:
    def __init__(self, status_code=200, payload=None, text="", headers=None):
        self.status_code = status_code
        self._payload = payload
        self.text = text
        self.headers = headers or {"Content-Type": "application/json"}
        self.reason = "Error" if status_code >= 400 else "OK"
        self.content = b"" if payload is None and not text else b"x"

    def json(self):
        if self._payload is None:
            raise ValueError("No JSON payload")
        return self._payload


class FakeSession:
    def __init__(self, response=None, error=None):
        self.response = response
        self.error = error
        self.last_request = None
        self.requests = []
        self.call_count = 0

    def post(self, url, json, headers, timeout):
        self.last_request = {
            "url": url,
            "json": json,
            "headers": headers,
            "timeout": timeout,
        }
        self.requests.append(self.last_request)
        self.call_count += 1
        if self.error:
            raise self.error
        if isinstance(self.response, list):
            return self.response[self.call_count - 1]
        return self.response


def test_bridge_client_posts_json_with_bearer_token():
    session = FakeSession(
        response=FakeResponse(
            payload={"pluginAvailable": True, "mutationsEnabled": False}
        )
    )
    client = DesktopBridgeClient(
        base_url="http://127.0.0.1:23119/zero-mcp",
        token="secret-token",
        timeout=12,
        session=session,
    )

    result = client.capabilities(verbose=True)

    assert session.last_request["url"] == "http://127.0.0.1:23119/zero-mcp/health"
    assert session.last_request["json"] == {"verbose": True}
    assert session.last_request["headers"]["Authorization"] == "Bearer secret-token"
    assert session.last_request["timeout"] == 12
    assert result["ok"] is True
    assert result["pluginAvailable"] is True


def test_bridge_client_raises_structured_error_on_http_failure():
    session = FakeSession(
        response=FakeResponse(
            status_code=409,
            payload={
                "ok": False,
                "error": {
                    "code": "DUPLICATE_COLLECTION",
                    "message": "Collection already exists",
                },
            },
            text="Collection already exists",
        )
    )
    client = DesktopBridgeClient(
        base_url="http://127.0.0.1:23119/zero-mcp",
        token="secret-token",
        session=session,
    )

    try:
        client.create_collection(path="Planning/Agents")
    except DesktopBridgeError as error:
        assert error.code == "DUPLICATE_COLLECTION"
        assert error.status_code == 409
        assert error.message == "Collection already exists"
    else:
        raise AssertionError("DesktopBridgeError was not raised")


def test_bridge_client_wraps_transport_errors():
    session = FakeSession(error=requests.ConnectionError("connection refused"))
    client = DesktopBridgeClient(
        base_url="http://127.0.0.1:23119/zero-mcp",
        token="secret-token",
        session=session,
    )

    try:
        client.delete_collection(collectionKey="ABCD1234")
    except DesktopBridgeError as error:
        assert error.code == "BRIDGE_UNAVAILABLE"
        assert "http://127.0.0.1:23119/zero-mcp/collections/delete" in error.message
    else:
        raise AssertionError("DesktopBridgeError was not raised")


def test_bridge_client_retries_with_discovered_secret_after_401(monkeypatch):
    session = FakeSession(
        response=[
            FakeResponse(
                status_code=401,
                payload={
                    "ok": False,
                    "error": {
                        "code": "UNAUTHORIZED",
                        "message": "The provided Bearer token does not match the configured bridge secret",
                    },
                },
                text="unauthorized",
            ),
            FakeResponse(payload={"pluginAvailable": True}),
        ]
    )
    monkeypatch.setattr(
        "zotero_mcp.desktop_bridge_client.discover_active_bridge_secret",
        lambda: "fresh-secret",
    )
    client = DesktopBridgeClient(
        base_url="http://127.0.0.1:23119/zero-mcp",
        token="stale-secret",
        session=session,
    )

    result = client.capabilities()

    assert session.requests[0]["headers"]["Authorization"] == "Bearer stale-secret"
    assert session.requests[1]["headers"]["Authorization"] == "Bearer fresh-secret"
    assert client.token == "fresh-secret"
    assert result["pluginAvailable"] is True


def test_bridge_client_delete_item_posts_expected_endpoint():
    session = FakeSession(response=FakeResponse(payload={"deleted": True}))
    client = DesktopBridgeClient(
        base_url="http://127.0.0.1:8000/zero-mcp",
        token="secret-token",
        session=session,
    )

    result = client.delete_item(itemKey="ITEM0001", force=True)

    assert session.last_request["url"] == "http://127.0.0.1:8000/zero-mcp/items/delete"
    assert session.last_request["json"] == {"itemKey": "ITEM0001", "force": True}
    assert result["deleted"] is True


def test_bridge_client_move_items_between_collections_posts_expected_endpoint():
    session = FakeSession(response=FakeResponse(payload={"moved": 1, "failed": 0}))
    client = DesktopBridgeClient(
        base_url="http://127.0.0.1:8000/zero-mcp",
        token="secret-token",
        session=session,
    )

    result = client.move_items_between_collections(
        sourceCollectionPath="Agentic RL/2025",
        targetCollectionPath="Agentic RL/Memory",
        itemKeys=["ITEM0001"],
        moveAll=False,
        dryRun=True,
    )

    assert (
        session.last_request["url"]
        == "http://127.0.0.1:8000/zero-mcp/items/move-between-collections"
    )
    assert session.last_request["json"] == {
        "sourceCollectionPath": "Agentic RL/2025",
        "targetCollectionPath": "Agentic RL/Memory",
        "itemKeys": ["ITEM0001"],
        "moveAll": False,
        "dryRun": True,
    }
    assert result["moved"] == 1


def test_bridge_client_move_items_between_collections_supports_move_all_without_item_keys():
    session = FakeSession(response=FakeResponse(payload={"moved": 2, "failed": 0}))
    client = DesktopBridgeClient(
        base_url="http://127.0.0.1:8000/zero-mcp",
        token="secret-token",
        session=session,
    )

    result = client.move_items_between_collections(
        sourceCollectionKey="SRC00001",
        targetCollectionKey="DST00001",
        moveAll=True,
        continueOnError=False,
    )

    assert (
        session.last_request["url"]
        == "http://127.0.0.1:8000/zero-mcp/items/move-between-collections"
    )
    assert session.last_request["json"] == {
        "sourceCollectionKey": "SRC00001",
        "targetCollectionKey": "DST00001",
        "moveAll": True,
        "continueOnError": False,
    }
    assert result["moved"] == 2


def test_bridge_client_batch_update_tags_posts_expected_endpoint():
    session = FakeSession(response=FakeResponse(payload={"updated": 1, "failed": 0}))
    client = DesktopBridgeClient(
        base_url="http://127.0.0.1:8000/zero-mcp",
        token="secret-token",
        session=session,
    )

    result = client.batch_update_tags(itemKeys=["ITEM0001"], addTags=["new"], removeTags=["old"])

    assert session.last_request["url"] == "http://127.0.0.1:8000/zero-mcp/items/batch-update-tags"
    assert session.last_request["json"] == {
        "itemKeys": ["ITEM0001"],
        "addTags": ["new"],
        "removeTags": ["old"],
    }
    assert result["updated"] == 1
