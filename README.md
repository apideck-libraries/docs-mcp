# Apideck Docs MCP

[Apideck developer docs](https://developers.apideck.com/) · [Sign up](https://www.apideck.com/signup) · [Developer guides](https://developers.apideck.com/guides) · [Changelog](https://developers.apideck.com/changelog)

Coding agents write integration code from what they remember about an API, and that memory goes stale. Apideck Docs MCP lets an agent look up the current docs while it works. Point it at a folder of Markdown and it gives the agent three tools, `search_docs`, `get_doc` and `list_docs`, over stdio for Claude Code, Cursor and Claude Desktop, or over Streamable HTTP for a hosted endpoint.

We run it for the Apideck developer docs at `https://developers.apideck.com/mcp`. Connect your agent there and it can read our accounting guides while it builds, including:

- [Accounts payable automation](https://developers.apideck.com/guides/accounts-payable-automation)
- [Accounts receivable automation](https://developers.apideck.com/guides/accounts-receivable-automation)
- [Bank feeds](https://developers.apideck.com/guides/bank-feeds)
- [Business lending](https://developers.apideck.com/guides/business-lending-accounting-api)
- [Debt collections](https://developers.apideck.com/guides/debt-collections-accounting-api)
- [Expense management](https://developers.apideck.com/guides/expense-management-integration)
- [FP&A: budgeting, forecasting and variance reporting](https://developers.apideck.com/guides/fpa-with-accounting-api)
- [FX payments and realized gain/loss](https://developers.apideck.com/guides/fx-payments-accounting-api)
- [Payroll journal entries](https://developers.apideck.com/guides/payroll-journal-entries)
- [Procurement](https://developers.apideck.com/guides/procurement-accounting-api)
- [Tax automation](https://developers.apideck.com/guides/tax-automation-accounting-api)

You can install it from npm as `@apideck/docs-mcp`, then run it as a CLI, deploy it as a Vercel function, or mount it inside an existing Node or Next.js site. The `docs/` folder in this repo holds the sample content and the server's own documentation. Start with [docs/index.md](docs/index.md).

## Quick start

```bash
pnpm install
pnpm run audit --docs ./docs               # find broken links, thin pages and stale content
pnpm run search vercel --docs ./docs       # query the index from your terminal
pnpm run start --docs ./docs               # MCP over stdio
pnpm run serve --docs ./docs --port 3000   # MCP over HTTP at http://localhost:3000/mcp
```

Keep the `run`: `audit` and `search` are also built-in pnpm commands, so `pnpm audit` runs pnpm's own security audit instead of this one.

Build once (`pnpm build`) and the `docs-mcp` binary in `dist/bin/` runs the same commands without tsx.

## Connect Claude Code

```bash
claude mcp add my-docs -- docs-mcp start --docs /path/to/docs --base-url https://docs.example.com
```

Or commit a `.mcp.json` next to the docs:

```json
{
  "mcpServers": {
    "my-docs": {
      "command": "docs-mcp",
      "args": ["start", "--docs", "./docs", "--base-url", "https://docs.example.com", "--about", "the Example API reference"]
    }
  }
}
```

## Commands

| Command | What it does |
| --- | --- |
| `docs-mcp start` | MCP over stdio. Re-indexes on file changes (`--watch` is on by default). |
| `docs-mcp serve --port 3000` | MCP over Streamable HTTP, same handler as the Vercel function. |
| `docs-mcp audit` | Reports broken links, thin or empty pages, stale pages, missing titles/descriptions, duplicate titles, heading skips and over-long sections. Exit 1 on errors. |
| `docs-mcp search "query"` | Runs a search against the index from the terminal. |

Shared flags: `--docs`, `--base-url`, `--about`, `--name`. Each falls back to `DOCS_DIR`, `DOCS_BASE_URL`, `DOCS_ABOUT`, `DOCS_NAME`.

## Tools

- `search_docs(query, limit?, path_prefix?)`: heading-level full-text search with title and heading boosts, prefix and fuzzy matching, and at most three hits per page.
- `get_doc(path, section?)`: full page markdown with a header and section outline, or one section and its sub-sections. `path` also accepts a full URL.
- `list_docs(path_prefix?, limit?)`: pages with title, description, word count and last-modified date.

Every page is also an MCP resource at `docs://<path>`. Full reference: [docs/tools.md](docs/tools.md).

## Logging tool calls

Pass `onToolCall` to `createServer` or `createHttpHandler` to get the tool, arguments, timing, result count and caller for every call. `search_docs` calls with `resultCount: 0` are the questions your docs can't answer. The Vercel function logs each call as a JSON line when `DOCS_LOG_TOOL_CALLS=1`. See [docs/tools.md](docs/tools.md#logging-tool-calls).

## WebMCP for browser agents

`@apideck/docs-mcp/webmcp` registers the server's tools, plus `read_current_page`, with `document.modelContext` on your docs site, so browser agents call tools instead of scraping:

```ts
import { registerDocsTools } from '@apideck/docs-mcp/webmcp'
registerDocsTools({ endpoint: '/mcp' })
```

It does nothing in browsers without WebMCP (currently Chrome 149+ behind a flag or origin trial). See [docs/webmcp.md](docs/webmcp.md).

## Hosting on Vercel

`api/mcp.ts` is a stateless Streamable HTTP function; `vercel.json` rewrites `/mcp` to it and bundles `docs/**` with the function. Set `DOCS_BASE_URL` and `DOCS_ABOUT` in the project environment and deploy. Details in [docs/hosting.md](docs/hosting.md).

## Use as a library

Mount the handler inside a site that already builds its docs, so the endpoint lives next to them. A Next.js pages-router API route:

```ts
// src/pages/api/mcp.ts
import { createHttpHandler, DocStore } from '@apideck/docs-mcp'
import type { NextApiRequest, NextApiResponse } from 'next'
import path from 'path'

const store = new DocStore({ root: path.join(process.cwd(), 'public', 'md'), baseUrl: 'https://docs.example.com' })
const handler = createHttpHandler({ store, name: 'example-docs', about: 'the Example API documentation' })

export const config = { maxDuration: 60, api: { responseLimit: false } }
export default (req: NextApiRequest, res: NextApiResponse) => handler(req, res)
```

Add `experimental.outputFileTracingIncludes: { '/api/mcp': ['./public/md/**/*'] }` to `next.config` so the markdown ships with the function on Vercel. `DocStore` also takes a `metadata(path)` hook to supply titles, descriptions and canonical URLs from a build manifest, and `get_doc` accepts a full URL as well as a path. Pass `extraTools` to `createServer`/`createHttpHandler` to add host-specific tools (an API operation index, a coverage matrix, ...) alongside the three built-ins — see [docs/tools.md](docs/tools.md#extending-the-server-with-host-specific-tools). Exports: `DocStore`, `createServer`, `createHttpHandler`, `createDocTools`, `toolResult`, `READ_ONLY`, `auditDocs`, `formatAuditReport`, `createStore`, `resolveConfig`, `normalizePath`, `sectionUrl`, `tokenize`; `registerDocsTools` from `@apideck/docs-mcp/webmcp`.

## SDK v2 migration (0.3.0)

See [the migration notes](docs/migrating-to-sdk-v2.md) for updated public SDK types,
transport defaults and release/adoption guidance. 0.3.0 is prepared but not yet
published; until it is, the latest package on npm (0.2.0) still uses SDK v1.

## Development

```bash
pnpm typecheck
pnpm lint
pnpm test        # builds first; covers parsing, indexing, audit, HTTP, compiled CLI and public types
pnpm build
```

Layout mirrors `@apideck/mcp`: `src/` for the library, `bin/` for the stricli CLI, `api/` for the Vercel function, tests co-located as `*.test.ts`.

## How it works

1. Every `.md`/`.mdx`/`.markdown` file under the docs root is read, frontmatter parsed, and the body split on ATX headings (code fences respected).
2. Each section becomes a document in a MiniSearch index with `title`, `heading`, `content` and `path` fields.
3. Queries run with all terms required first, falling back to any term, so a typo does not return nothing.
4. In `start` and `serve`, a recursive file watcher rebuilds the index 300 ms after the last change. On Vercel the index is built once per function instance and refreshed by each deploy.

## License

MIT
