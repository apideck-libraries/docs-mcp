---
title: Hosting
description: Run docs-mcp as a public Streamable HTTP endpoint on Vercel or any Node host.
updated: 2026-09-12
---

# Hosting

A hosted endpoint gives every agent in the team, and every customer's agent, the same current view of the docs. This is the model OpenAI uses for its Docs MCP and Microsoft uses for the Microsoft Learn MCP Server.

## Local HTTP

```bash
docs-mcp serve --port 3000 --docs ./docs
```

The MCP endpoint is `http://localhost:3000/mcp`. A `GET` on the same path returns a JSON summary with the page count and when the index was built, which is handy for health checks.

## Vercel

The repository includes `api/mcp.ts` and a `vercel.json` that rewrites `/mcp` to it. The function is stateless: each request creates a fresh MCP server over a shared, in-memory index that is built once per function instance.

1. Set `DOCS_DIR` (defaults to `docs`), `DOCS_BASE_URL`, `DOCS_ABOUT` and optionally `DOCS_NAME` as environment variables.
2. Keep the docs folder inside the repository; `vercel.json` lists it under `includeFiles` so it ships with the function.
3. Deploy with `vercel deploy --prod`.

Because the index is rebuilt on every deploy, the hosted docs are as fresh as the last push. There is no file watching on Vercel.

### Docs that live elsewhere

If the docs are in another repository, add a build step that clones or syncs them into `docs/` before the function bundles, or publish the docs as a package and copy them in `postinstall`.

## Connecting clients to a hosted endpoint

Claude Code:

```bash
claude mcp add --transport http acme-docs https://docs-mcp.acme.com/mcp
```

Any client that supports Streamable HTTP can use the same URL. The endpoint sends permissive CORS headers so browser-based clients work too.

## Authentication

The server is read-only and, like the OpenAI and Microsoft endpoints, is intended to be public. If your docs are private, put the endpoint behind your existing gateway or add a bearer check at the top of the handler in `api/mcp.ts`.
