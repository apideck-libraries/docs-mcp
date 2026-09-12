# docs-mcp

An MCP server that lets AI agents search and read your documentation at query time, instead of relying on stale training data. Point it at a folder of Markdown and it exposes `search_docs`, `get_doc` and `list_docs` over stdio (for Claude Code, Cursor, Claude Desktop) and over Streamable HTTP (for a hosted, public endpoint like OpenAI's Docs MCP or the Microsoft Learn MCP Server).

The `docs/` folder in this repo is both the sample content and the server's own documentation. Start there: [docs/index.md](docs/index.md).

## Quick start

```bash
pnpm install
pnpm audit -- --docs ./docs          # check the docs are complete, current, structured
pnpm search -- "vercel" --docs ./docs # try the index from the terminal
pnpm start -- --docs ./docs           # MCP over stdio
pnpm serve -- --docs ./docs --port 3000   # MCP over HTTP at http://localhost:3000/mcp
```

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
- `get_doc(path, section?)`: full page markdown with a header and section outline, or one section and its sub-sections.
- `list_docs(path_prefix?, limit?)`: pages with title, description, word count and last-modified date.

Every page is also an MCP resource at `docs://<path>`. Full reference: [docs/tools.md](docs/tools.md).

## Hosting on Vercel

`api/mcp.ts` is a stateless Streamable HTTP function; `vercel.json` rewrites `/mcp` to it and bundles `docs/**` with the function. Set `DOCS_BASE_URL` and `DOCS_ABOUT` in the project environment and deploy. Details in [docs/hosting.md](docs/hosting.md).

## Development

```bash
pnpm typecheck
pnpm lint
pnpm test        # node:test via tsx, covers parsing, indexing, audit, MCP over in-memory and HTTP transports
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
