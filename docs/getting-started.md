---
title: Getting started
description: Install docs-mcp, point it at a docs folder, and connect it to Claude Code or another MCP client.
updated: 2026-09-12
---

# Getting started

## Requirements

- Node.js 20 or newer.
- A directory of Markdown files. Frontmatter is optional but recommended; see [Writing docs that search well](auditing.md#writing-docs-that-search-well).

## Install

From the repository:

```bash
pnpm install
pnpm build
```

The build produces `dist/bin/docs-mcp.js`, which the `docs-mcp` binary points at.

## Run over stdio

```bash
docs-mcp start --docs ./docs --base-url https://docs.example.com
```

Flags can also come from the environment: `DOCS_DIR`, `DOCS_BASE_URL`, `DOCS_ABOUT` and `DOCS_NAME`. The `--about` flag sets the one-line description agents see in the server instructions, so make it specific: "the Acme billing API reference" beats "our docs".

## Connect Claude Code

```bash
claude mcp add acme-docs -- docs-mcp start --docs /path/to/docs --base-url https://docs.acme.com
```

Or add it to `.mcp.json` in the project so every teammate gets it:

```json
{
  "mcpServers": {
    "acme-docs": {
      "command": "docs-mcp",
      "args": ["start", "--docs", "./docs", "--base-url", "https://docs.acme.com"]
    }
  }
}
```

## Connect Cursor or Claude Desktop

Both accept the same `command` and `args` shape in their MCP settings. For a hosted endpoint, use the HTTP URL instead; see [Hosting](hosting.md#connecting-clients-to-a-hosted-endpoint).

## Try a search from the terminal

```bash
docs-mcp search "rate limits" --docs ./docs
```

This runs the same index the server uses, which makes it a quick way to check that a page is findable before an agent asks for it.
