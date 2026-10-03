---
title: WebMCP
description: Expose the docs tools to browser agents on your docs site through WebMCP, so they call tools instead of scraping pages.
updated: 2026-10-03
---

# WebMCP

[WebMCP](https://developer.chrome.com/docs/ai/webmcp) lets a web page register structured tools that an agent running in the browser can call. Without it, a browser agent on your docs site reads the rendered HTML: navigation, cookie banners, code tabs and all. With it, the agent calls `search_docs` or `read_current_page` and gets the clean Markdown your MCP server already serves.

The `@apideck/docs-mcp/webmcp` entry point is a small browser module that bridges the two. It has no Node dependencies.

## Register the tools

Load it on every docs page, pointing at your hosted endpoint:

```ts
import { registerDocsTools } from '@apideck/docs-mcp/webmcp'

registerDocsTools({ endpoint: '/mcp' })
```

On page load it calls `tools/list` on the endpoint and registers each tool with `document.modelContext.registerTool`, using the server's own names, descriptions and input schemas. Tools you add with `extraTools` on the server appear in the browser without any client change. Every tool is registered with `readOnlyHint: true`, so agents do not need to stop and ask the user before calling one.

When the browser has no `document.modelContext`, `registerDocsTools` does nothing and resolves with an empty tool list, so it is safe to ship to every visitor.

## The read_current_page tool

Alongside the server tools, the bridge registers `read_current_page`. It calls `get_doc` with `location.href`, so an agent can read the page the user is looking at, or one section of it via the URL fragment or a `section` argument. This needs pages to have public URLs, set with `--base-url` or the `metadata` hook. Turn it off with `currentPageTool: false`.

## Options

| Option | Default | Purpose |
| --- | --- | --- |
| `endpoint` | required | URL of the MCP endpoint. Same-origin is simplest. |
| `headers` | none | Extra request headers, such as a token for a gated endpoint. |
| `tools` | all | Only register these server tools, by name. |
| `currentPageTool` | `true` | Register `read_current_page`. |

The returned object has `tools`, the registered names, and `unregister()`, which removes them all.

## Seeing browser agent traffic

The bridge sends `X-MCP-Client: webmcp` with every call. With an [`onToolCall` hook](tools.md#logging-tool-calls) on the server, those calls arrive with `client: "webmcp"`, so you can tell browser agents apart from Claude Code, Cursor and other MCP clients.

## Browser support

WebMCP is experimental. It needs Chrome 149 or later. For local testing, enable `chrome://flags/#enable-webmcp-testing`. For a production docs site, register for the [WebMCP origin trial](https://developer.chrome.com/origintrials/#/register_trial/4163014905550602241) and add the token to your pages. Tools are available to the page's own origin by default; a cross-origin iframe needs `allow="tools"`.
