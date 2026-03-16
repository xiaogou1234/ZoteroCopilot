# Architecture

ZoteroCopilot is designed as a local-first system.

## Components

### MCP helper

- Serves MCP clients over `http://127.0.0.1:8000/mcp`
- Adapts local Zotero capabilities into MCP tools
- Hosts the helper-facing bridge proxy at `http://127.0.0.1:8000/zero-mcp`

### Zotero desktop plugin

- Runs inside Zotero 7
- Exposes localhost-only mutation endpoints
- Owns write operations that need Zotero's local JavaScript APIs

### Local read layer

- Reads from the local Zotero database and local desktop environment
- Supports metadata retrieval, notes, collections, tags, and semantic search indexing

## Write path

Write operations flow through the desktop bridge:

1. MCP client calls the helper
2. Helper forwards the mutation to the helper-facing bridge
3. The plugin executes the mutation inside Zotero

This keeps the supported write path local-only and avoids depending on the Zotero Web API for normal product usage.

## Semantic search

- Uses a local Chroma database
- Supports metadata-first and optional full-text indexing
- Checks index state before search and refreshes or rebuilds when needed

## Collection moves

The collection move API changes collection membership only. It does not move metadata records or attachment files on disk.
