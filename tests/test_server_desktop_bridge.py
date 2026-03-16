from pathlib import Path

from zotero_mcp import server
from zotero_mcp.desktop_bridge_client import DesktopBridgeError


class DummyContext:
    def info(self, *_args, **_kwargs):
        return None

    def error(self, *_args, **_kwargs):
        return None

    def warn(self, *_args, **_kwargs):
        return None


def test_get_desktop_plugin_capabilities_returns_structured_result(monkeypatch):
    class FakeBridge:
        def capabilities(self, *, verbose=False):
            assert verbose is True
            return {
                "pluginAvailable": True,
                "mutationsEnabled": False,
                "architectureMode": "desktop-bridge-first",
                "authoritativeWriteLayer": "zotero-desktop-bridge",
                "helperRole": "mcp-adapter",
                "clientReconnectRequiredAfterHelperRestart": True,
            }

    monkeypatch.setattr(server, "get_desktop_bridge_client", lambda: FakeBridge())

    result = server.get_desktop_plugin_capabilities(verbose=True, ctx=DummyContext())

    assert result["ok"] is True
    assert result["operation"] == "getDesktopPluginCapabilities"
    assert result["pluginAvailable"] is True
    assert result["mutationsEnabled"] is False
    assert result["architectureMode"] == "desktop-bridge-first"
    assert result["authoritativeWriteLayer"] == "zotero-desktop-bridge"
    assert result["helperRole"] == "mcp-adapter"
    assert result["clientReconnectRequiredAfterHelperRestart"] is True


def test_create_collection_validates_missing_name_and_path():
    result = server.create_collection(ctx=DummyContext())

    assert result["ok"] is False
    assert result["error"]["code"] == "VALIDATION_ERROR"
    assert "name or path" in result["error"]["message"]


def test_delete_collection_normalizes_bridge_errors(monkeypatch):
    class FakeBridge:
        def delete_collection(self, **_payload):
            raise DesktopBridgeError(
                "COLLECTION_NOT_FOUND",
                "No collection found for path Planning/Missing",
                status_code=404,
            )

    monkeypatch.setattr(server, "get_desktop_bridge_client", lambda: FakeBridge())

    result = server.delete_collection(
        collection_path="Planning/Missing",
        ctx=DummyContext(),
    )

    assert result["ok"] is False
    assert result["operation"] == "deleteCollection"
    assert result["error"]["code"] == "COLLECTION_NOT_FOUND"
    assert result["error"]["statusCode"] == 404


def test_delete_item_passes_bridge_payload(monkeypatch):
    captured = {}

    class FakeBridge:
        def delete_item(self, **payload):
            captured.update(payload)
            return {"deleted": False, "dryRun": True}

    monkeypatch.setattr(server, "get_desktop_bridge_client", lambda: FakeBridge())

    result = server.delete_item(
        item_key="ITEM0001",
        force=True,
        dry_run=True,
        idempotency_key="abc123",
        ctx=DummyContext(),
    )

    assert result["ok"] is True
    assert captured == {
        "itemKey": "ITEM0001",
        "force": True,
        "dryRun": True,
        "idempotencyKey": "abc123",
    }


def test_move_items_between_collections_validates_missing_targets():
    result = server.move_items_between_collections(
        item_keys=["ITEM0001"],
        ctx=DummyContext(),
    )

    assert result["ok"] is False
    assert result["operation"] == "moveItemsBetweenCollections"
    assert result["error"]["code"] == "VALIDATION_ERROR"
    assert "source_collection_key or source_collection_path" in result["error"]["message"]


def test_move_items_between_collections_validates_missing_item_keys_without_move_all():
    result = server.move_items_between_collections(
        source_collection_path="Agentic RL/2025",
        target_collection_path="Agentic RL/Memory",
        ctx=DummyContext(),
    )

    assert result["ok"] is False
    assert result["operation"] == "moveItemsBetweenCollections"
    assert result["error"]["code"] == "VALIDATION_ERROR"
    assert "item_keys or set move_all=true" in result["error"]["message"]


def test_move_items_between_collections_passes_bridge_payload(monkeypatch):
    captured = {}

    class FakeBridge:
        def move_items_between_collections(self, **payload):
            captured.update(payload)
            return {"moved": 1, "failed": 0, "results": []}

    monkeypatch.setattr(server, "get_desktop_bridge_client", lambda: FakeBridge())

    result = server.move_items_between_collections(
        source_collection_path="Agentic RL/2025",
        target_collection_key="TARGET0001",
        item_keys=[" ITEM0001 ", "ITEM0002", "", "ITEM0001"],
        continue_on_error=False,
        dry_run=True,
        idempotency_key="move-123",
        ctx=DummyContext(),
    )

    assert result["ok"] is True
    assert captured == {
        "sourceCollectionKey": None,
        "sourceCollectionPath": "Agentic RL/2025",
        "targetCollectionKey": "TARGET0001",
        "targetCollectionPath": None,
        "itemKeys": ["ITEM0001", "ITEM0002", "ITEM0001"],
        "moveAll": False,
        "continueOnError": False,
        "dryRun": True,
        "idempotencyKey": "move-123",
    }


def test_move_items_between_collections_allows_move_all_without_item_keys(monkeypatch):
    captured = {}

    class FakeBridge:
        def move_items_between_collections(self, **payload):
            captured.update(payload)
            return {"moved": 2, "failed": 0, "results": []}

    monkeypatch.setattr(server, "get_desktop_bridge_client", lambda: FakeBridge())

    result = server.move_items_between_collections(
        source_collection_key="SRC00001",
        target_collection_path="Agentic RL/Memory",
        move_all=True,
        ctx=DummyContext(),
    )

    assert result["ok"] is True
    assert captured == {
        "sourceCollectionKey": "SRC00001",
        "sourceCollectionPath": None,
        "targetCollectionKey": None,
        "targetCollectionPath": "Agentic RL/Memory",
        "itemKeys": [],
        "moveAll": True,
        "continueOnError": True,
        "dryRun": False,
        "idempotencyKey": None,
    }


def test_move_items_between_collections_normalizes_bridge_error(monkeypatch):
    class FakeBridge:
        def move_items_between_collections(self, **_payload):
            raise DesktopBridgeError(
                "ITEM_NOT_IN_SOURCE_COLLECTION",
                "The specified item is not currently in the source collection",
                status_code=409,
            )

    monkeypatch.setattr(server, "get_desktop_bridge_client", lambda: FakeBridge())

    result = server.move_items_between_collections(
        source_collection_path="Agentic RL/2025",
        target_collection_path="Agentic RL/Memory",
        item_keys=["ITEM0001"],
        ctx=DummyContext(),
    )

    assert result["ok"] is False
    assert result["operation"] == "moveItemsBetweenCollections"
    assert result["error"]["code"] == "ITEM_NOT_IN_SOURCE_COLLECTION"
    assert result["error"]["statusCode"] == 409


def test_move_items_between_collections_preserves_bridge_result_statuses(monkeypatch):
    class FakeBridge:
        def move_items_between_collections(self, **_payload):
            return {
                "total": 1,
                "moved": 1,
                "failed": 0,
                "results": [
                    {
                        "itemKey": "ITEM0001",
                        "sourceCollectionKey": "SRC00001",
                        "targetCollectionKey": "DST00001",
                        "status": "already_in_target_moved",
                        "remainingCollectionKeys": ["DST00001"],
                        "warnings": ["Item is already filed in the target collection"],
                    }
                ],
            }

    monkeypatch.setattr(server, "get_desktop_bridge_client", lambda: FakeBridge())

    result = server.move_items_between_collections(
        source_collection_key="SRC00001",
        target_collection_key="DST00001",
        item_keys=["ITEM0001"],
        ctx=DummyContext(),
    )

    assert result["ok"] is True
    assert result["results"][0]["status"] == "already_in_target_moved"
    assert result["results"][0]["warnings"] == [
        "Item is already filed in the target collection"
    ]


def test_batch_create_collections_normalizes_request_keys(monkeypatch):
    captured = {}

    class FakeBridge:
        def batch_create_collections(self, **payload):
            captured.update(payload)
            return {"created": [], "dryRun": True}

    monkeypatch.setattr(server, "get_desktop_bridge_client", lambda: FakeBridge())

    result = server.batch_create_collections(
        collection_requests=[
            {
                "path": "Codex Smoke/Child",
                "create_missing_parents": True,
                "if_exists": "skip",
                "dry_run": True,
            }
        ],
        dry_run=True,
        ctx=DummyContext(),
    )

    assert result["ok"] is True
    assert captured["requests"] == [
        {
            "path": "Codex Smoke/Child",
            "createMissingParents": True,
            "ifExists": "skip",
            "dryRun": True,
        }
    ]


def test_import_pdf_to_collection_passes_bridge_payload(monkeypatch, tmp_path):
    captured = {}
    source_dir = tmp_path / "source"
    buffer_dir = tmp_path / "buffer"
    source_dir.mkdir()
    buffer_dir.mkdir()
    source_path = source_dir / "example.pdf"
    source_path.write_bytes(b"%PDF-1.4\nexample")

    class FakeBridge:
        def capabilities(self, *, verbose=False):
            return {"pluginAvailable": True, "bufferDirectory": str(buffer_dir)}

        def import_pdf_to_collection(self, **payload):
            captured.update(payload)
            return {"status": "dry_run", "warnings": []}

    monkeypatch.setattr(server, "get_desktop_bridge_client", lambda: FakeBridge())

    result = server.import_pdf_to_collection(
        file_path=str(source_path),
        target_collection_path="Planning/Agents",
        title="Example Paper",
        authors=["Ada Lovelace", "Grace Hopper"],
        year=2025,
        doi="10.1000/example",
        link_mode="linked_file",
        on_duplicate="skip",
        create_target_if_missing=True,
        dry_run=True,
        ctx=DummyContext(),
    )

    assert result["ok"] is True
    assert captured["filePath"].startswith(str(buffer_dir))
    assert result["stagedFilePath"].startswith(str(buffer_dir))
    assert result["sourceFilePath"] == str(source_path)
    assert not Path(captured["filePath"]).exists()
    assert captured["targetCollectionPath"] == "Planning/Agents"
    assert captured["title"] == "Example Paper"
    assert captured["authors"] == ["Ada Lovelace", "Grace Hopper"]
    assert captured["year"] == "2025"
    assert captured["doi"] == "10.1000/example"
    assert captured["linkMode"] == "linked_file"
    assert captured["onDuplicate"] == "skip"
    assert captured["createTargetIfMissing"] is True
    assert captured["dryRun"] is True


def test_import_pdf_to_collection_omits_optional_defaults_when_not_supplied(monkeypatch, tmp_path):
    captured = {}
    source_dir = tmp_path / "source"
    buffer_dir = tmp_path / "buffer"
    source_dir.mkdir()
    buffer_dir.mkdir()
    source_path = source_dir / "minimal.pdf"
    source_path.write_bytes(b"%PDF-1.4\nminimal")

    class FakeBridge:
        def capabilities(self, *, verbose=False):
            return {"pluginAvailable": True, "bufferDirectory": str(buffer_dir)}

        def import_pdf_to_collection(self, **payload):
            captured.update(payload)
            return {"status": "ok"}

    monkeypatch.setattr(server, "get_desktop_bridge_client", lambda: FakeBridge())

    result = server.import_pdf_to_collection(
        file_path=str(source_path),
        target_collection_path="Planning/Agents",
        ctx=DummyContext(),
    )

    assert result["ok"] is True
    assert captured["filePath"].startswith(str(buffer_dir))
    assert captured["targetCollectionPath"] == "Planning/Agents"
    assert captured["linkMode"] is None
    assert captured["onDuplicate"] is None


def test_batch_import_pdfs_to_collection_stages_directory_before_bridge(monkeypatch, tmp_path):
    source_dir = tmp_path / "source"
    buffer_dir = tmp_path / "buffer"
    source_dir.mkdir()
    buffer_dir.mkdir()
    (source_dir / "a.pdf").write_bytes(b"%PDF-1.4\na")
    (source_dir / "b.pdf").write_bytes(b"%PDF-1.4\nb")
    captured = {}

    class FakeBridge:
        def capabilities(self, *, verbose=False):
            return {"pluginAvailable": True, "bufferDirectory": str(buffer_dir)}

        def batch_import_pdfs_to_collection(self, **payload):
            captured.update(payload)
            return {"status": "dry_run", "results": []}

    monkeypatch.setattr(server, "get_desktop_bridge_client", lambda: FakeBridge())

    result = server.batch_import_pdfs_to_collection(
        directory_path=str(source_dir),
        target_collection_path="Planning/Agents",
        dry_run=True,
        ctx=DummyContext(),
    )

    assert result["ok"] is True
    assert captured["directoryPath"] is None
    assert len(captured["filePaths"]) == 2
    assert all(path.startswith(str(buffer_dir)) for path in captured["filePaths"])
    assert all(not Path(path).exists() for path in captured["filePaths"])
