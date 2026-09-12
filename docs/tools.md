---
title: Tools
description: Reference for the search_docs, get_doc and list_docs tools and the docs:// resource.
updated: 2026-09-12
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
| `path` | string | Page path as returned by `search_docs` or `list_docs`. Extensions, a leading `./` and a `docs://` prefix are all accepted. |
| `section` | string | Optional. An anchor such as `#install` or the heading text. Returns that heading and everything nested under it. |

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

## Path rules

Paths are relative to the docs root, use forward slashes, and drop the file extension. `guides/getting-started.md` becomes `guides/getting-started`. A request for `guides` resolves to `guides/index` or `guides/README` when such a file exists. Matching is case-insensitive as a last resort.
