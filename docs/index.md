---
title: docs-mcp
description: An MCP server that lets AI agents search and read your documentation at query time instead of relying on stale training data.
updated: 2026-09-12
---

# docs-mcp

docs-mcp turns a folder of Markdown into a read-only [Model Context Protocol](https://modelcontextprotocol.io) server. Agents such as Claude Code, Cursor and ChatGPT connect to it and pull current documentation into context while they work, the same way OpenAI's Docs MCP and the Microsoft Learn MCP Server expose their documentation.

## What it does

- Indexes every `.md`, `.mdx` and `.markdown` file under a directory, split by heading.
- Exposes three tools: `search_docs`, `get_doc` and `list_docs`. See [Tools](tools.md).
- Exposes every page as an MCP resource under `docs://<path>`.
- Re-indexes automatically when files change, so answers reflect what is on disk right now.
- Ships an `audit` command that checks the docs are complete, current and structured before you expose them. See [Auditing your docs](auditing.md).
- Runs over stdio for local editors and over Streamable HTTP for a hosted, public endpoint. See [Hosting](hosting.md).

## When to use MCP versus a skill file

A `skill.md` style file works well for stable workflows that rarely change: it is fast to write and machine-readable. An MCP server pays off when documentation changes often and agents need to search and retrieve the current version at query time. Many teams run both: a skill file for the stable workflow and an MCP server for the reference material behind it.

## Next steps

1. Follow [Getting started](getting-started.md) to run the server against your own docs.
2. Run the [audit](auditing.md) and fix what it reports.
3. [Host it](hosting.md) so every agent in the team uses the same endpoint.
