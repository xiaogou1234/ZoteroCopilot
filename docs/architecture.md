# Architecture

ZoteroCopilot is a local-first system with one read path and one write path.

## Components

### MCP helper

- Serves MCP clients over `http://127.0.0.1:8000/mcp`
- Exposes the helper-facing bridge proxy at `http://127.0.0.1:8000/zero-mcp`
- Hosts the read-only MCP tools plus the `search` / `fetch` compatibility tools

### Zotero desktop plugin

- Runs inside Zotero 7 and Zotero 8
- Shares one source tree across Windows and macOS
- Owns helper lifecycle management for local desktop usage
- Exposes localhost-only mutation endpoints inside Zotero

### Local read layer

- Reads from the local Zotero database and active Zotero profile
- Powers metadata, notes, collections, tags, recent items, and full-text retrieval
- Does not depend on vector databases or embedding models in `0.3.0`

## Read path

1. MCP client calls the helper
2. Helper reads from the local Zotero database or local profile-derived state
3. Helper returns normalized MCP results

The ChatGPT connectors `search` tool is now a keyword-search wrapper over local items. `fetch` still resolves item metadata and text by item key or Zotero URL.

## Write path

1. MCP client calls the helper
2. Helper forwards mutation requests to the local bridge proxy
3. The Zotero plugin executes the mutation inside Zotero

This keeps the supported write path local-only and avoids relying on the Zotero Web API for normal usage.

## Helper distribution model

- Internal build shape: `onedir`
- Public release shape:
  - macOS: `.tar.gz`
  - Windows: `.zip`
- End users must keep the extracted helper directory intact because the executable depends on `_internal/`
