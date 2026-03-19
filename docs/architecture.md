# Architecture

This document is for technical readers who need the system shape and data flow. User installation lives in the [top-level README](../README.md).

## Components

### MCP helper

- Serves MCP clients on `http://127.0.0.1:8000/mcp`
- Exposes the helper-facing bridge proxy on `http://127.0.0.1:8000/zero-mcp`
- Hosts the read tools and the connector-compatible `search` / `fetch` wrappers

### Zotero desktop plugin

- Runs inside Zotero 7 and Zotero 8
- Owns helper lifecycle management in desktop usage
- Exposes localhost-only mutation endpoints inside Zotero

### Local read layer

- Reads from the local Zotero database and active Zotero profile
- Powers metadata, notes, collections, tags, recent items, feeds, and full-text retrieval
- Does not depend on vector databases or embedding models in `0.3.0`

## Read Path

1. An MCP client calls the helper.
2. The helper reads from the local Zotero database or profile-derived state.
3. The helper returns normalized MCP results.

## Write Path

1. An MCP client calls the helper.
2. The helper forwards the mutation request to the local bridge proxy.
3. The Zotero plugin executes the mutation inside Zotero.

This keeps supported writes local-only and avoids relying on the Zotero Web API in normal desktop usage.

## Helper Distribution Model

- Internal build shape: `onedir`
- Public release shape:
  - macOS: `.tar.gz`
  - Windows: `.zip`
- The extracted helper directory must stay intact because the executable depends on `_internal/`

## Related Docs

- [README](../README.md)
- [Development](development.md)
