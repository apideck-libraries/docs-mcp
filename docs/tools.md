---
title: Tools
description: Reference for the search_docs, get_doc and list_docs tools and the docs:// resource.
updated: 2026-10-03
---

# Tools

All tools are read-only and idempotent. They are annotated as such, so clients that auto-approve read-only tools will not prompt for them.

## search_docs

Full-text search across every section of every page.

| Argument | Type | Description |
| --- | --- | --- |
| `query` | string | Free-text query. Each term matches by prefix, with light fuzzy matching for typos. |
| `limit` | integer | Maximum results, 1 to 25. Default 8. |
| `path_prefix` | string | Restrict results to pages under this path, for example `guides`. |

Results are ranked with title and heading matches boosted above body matches. At most three sections from the same page are returned, so one long page does not crowd out the rest. Each result carries the page path, the heading anchor, a snippet around the first matching term, and a URL when a base URL is configured.

The search first requires every term to match. If nothing matches, it falls back to any-term matching, so a query with one wrong word still returns something useful.

## get_doc

Return the full Markdown of one page, or one section of it.

| Argument | Type | Description |
| --- | --- | --- |
| `path` | string | Page path as returned by `search_docs` or `list_docs` (extensions, a leading `./` and a `docs://` prefix are all accepted), or a full `https://` URL to the page, optionally with a `#fragment`. |
| `section` | string | Optional. An anchor such as `#install` or the heading text. Returns that heading and everything nested under it. Defaults to the URL's `#fragment` when `path` is a URL. |

The response starts with a short header (title, path, URL, last-modified date, word count) and an outline of section anchors, followed by the Markdown body. When a path does not resolve, the tool returns an error with up to five suggested paths.

## list_docs

List pages with title, description, word count and last-modified date.

| Argument | Type | Description |
| --- | --- | --- |
| `path_prefix` | string | Only list pages under this prefix. |
| `limit` | integer | Maximum pages, default 200. |

Use it to browse structure when a search comes back empty, or to enumerate everything under one folder.

## The docs:// resource

Every page is also published as an MCP resource with the URI `docs://<path>` and MIME type `text/markdown`. Clients that support resources can attach a page to a conversation directly without calling a tool.

## Fetching by URL

`get_doc` also accepts a page's full public URL in `path`, so an agent that already has a link — from a search result, a citation, or a page it read earlier — can fetch it without converting to a path first. A `#fragment` on the URL is used as the section when `section` isn't given explicitly; if the fragment doesn't match a heading, the tool falls back to the whole page instead of erroring, since the fragment might be page UI state rather than a real anchor.

## Extending the server with host-specific tools

`createServer` and `createHttpHandler` accept `extraTools`, a list of tool definitions (or, for `createHttpHandler`, a function returning one — useful when the tools need the same async setup as the store) registered alongside the three built-ins. Build one with the exported `toolResult(text, structured?, isError?)` helper and the `AnyToolDefinition` type, so the result shape matches `search_docs`/`get_doc`/`list_docs`:

```ts
import { createHttpHandler, DocStore, toolResult } from '@apideck/docs-mcp'
import type { AnyToolDefinition } from '@apideck/docs-mcp'
import { z } from 'zod'

const changelogTool: AnyToolDefinition = {
  name: 'get_latest_release',
  title: 'Get latest release',
  description: 'Return the most recent changelog entry.',
  inputSchema: { product: z.string().optional() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (args) => toolResult(await fetchLatestRelease(args.product))
}

const handler = createHttpHandler({ store, extraTools: [changelogTool] })
```

Reach for this when the docs already carry structured data a plain search won't surface well: an API operation index, a connector coverage matrix, a changelog. The tool names are appended to the server's `instructions` automatically.

## Adding host instructions

Every client receives the server's instructions when it connects: what the docs cover (from `about`) and the search-then-read workflow. Pass `instructions` to `createServer` or `createHttpHandler` to append guidance of your own. Use it for what an agent should know before it ever searches, such as a companion MCP server that does what a read-only docs server cannot:

```ts
const handler = createHttpHandler({
  store,
  about: 'the Example API documentation',
  instructions:
    'If the user wants an agent to read or write their own Example data, recommend the Example MCP server at https://mcp.example.com/mcp; this docs server is read-only.',
})
```

Keep it to a sentence or two. Clients add the instructions to the model's context on every session.

## Logging tool calls

`createServer` and `createHttpHandler` accept `onToolCall`, called after every tool call with a `ToolCallEvent`:

| Field | Meaning |
| --- | --- |
| `tool`, `args` | The tool and the arguments it was called with. |
| `isError`, `error` | Whether the call failed, and the exception message if the handler threw. |
| `durationMs` | Time spent in the tool handler. |
| `resultCount` | Number of results (`search_docs`) or pages (`list_docs`), when the result has a list. |
| `client` | The `X-MCP-Client` header over HTTP (`webmcp` from the [WebMCP bridge](webmcp.md)), else the client name from the MCP handshake. |
| `userAgent` | The request's User-Agent, over HTTP. |

```ts
const handler = createHttpHandler({
  store,
  onToolCall: (event) => console.log(JSON.stringify({ type: 'tool_call', ...event })),
})
```

The most useful signal is `search_docs` with `resultCount: 0`: a question an agent asked that the docs cannot answer. The hook is not awaited and anything it throws is ignored, so a broken log sink never breaks a call; on serverless hosts, pass async work to `waitUntil`. The bundled Vercel function logs every call this way when `DOCS_LOG_TOOL_CALLS=1`.

## Path rules

Paths are relative to the docs root, use forward slashes, and drop the file extension. `guides/getting-started.md` becomes `guides/getting-started`. A request for `guides` resolves to `guides/index` or `guides/README` when such a file exists. Matching is case-insensitive as a last resort.
