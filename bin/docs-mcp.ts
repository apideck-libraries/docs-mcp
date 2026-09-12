// SPDX-License-Identifier: MIT

/**
 * docs-mcp CLI.
 *
 *   start   — MCP over stdio (for Claude Code, Cursor, Claude Desktop, ...).
 *   serve   — MCP over Streamable HTTP on a local port (same handler as the Vercel function).
 *   audit   — check the docs are complete, current and well structured before exposing them.
 *   search  — run a query against the index from the terminal.
 *
 * No shebang in source: tsc strips it; scripts/postbuild.mjs adds it to dist/bin/docs-mcp.js.
 */

import { realpathSync } from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildApplication, buildCommand, buildRouteMap, numberParser, run } from '@stricli/core';

import { createHandler } from '../api/mcp.js';
import { auditDocs, formatAuditReport } from '../src/audit.js';
import { createStore, resolveConfig } from '../src/config.js';
import { createServer } from '../src/server.js';

const log = (msg: string): void => {
  process.stderr.write(`docs-mcp: ${msg}\n`);
};

interface CommonFlags {
  docs?: string;
  'base-url'?: string;
  about?: string;
  name?: string;
}

const commonFlags = {
  docs: {
    kind: 'parsed',
    parse: String,
    brief: 'Directory containing the markdown docs (default: $DOCS_DIR or ./docs)',
    optional: true,
  },
  'base-url': {
    kind: 'parsed',
    parse: String,
    brief: 'Public site root used to build page URLs, e.g. https://docs.example.com (default: $DOCS_BASE_URL)',
    optional: true,
  },
  about: {
    kind: 'parsed',
    parse: String,
    brief: 'One-line description of the docs, shown to agents (default: $DOCS_ABOUT)',
    optional: true,
  },
  name: {
    kind: 'parsed',
    parse: String,
    brief: 'Server name reported to clients (default: $DOCS_NAME or docs-mcp)',
    optional: true,
  },
} as const;

const applyFlags = (flags: CommonFlags): void => {
  if (flags.docs !== undefined) process.env['DOCS_DIR'] = flags.docs;
  if (flags['base-url'] !== undefined) process.env['DOCS_BASE_URL'] = flags['base-url'];
  if (flags.about !== undefined) process.env['DOCS_ABOUT'] = flags.about;
  if (flags.name !== undefined) process.env['DOCS_NAME'] = flags.name;
};

const loadStore = async (flags: CommonFlags) => {
  applyFlags(flags);
  const config = resolveConfig();
  const store = createStore(config);
  await store.load();
  return { config, store };
};

const startCommand = buildCommand({
  func: async (flags: CommonFlags & { watch: boolean }): Promise<void> => {
    const { config, store } = await loadStore(flags);
    const stats = store.stats();
    log(`indexed ${stats.pages} pages / ${stats.sections} sections from ${config.docsDir}`);

    const stop = flags.watch
      ? store.watch((err) => {
          if (err) log(`reindex failed: ${err.message}`);
          else log(`reindexed: ${store.stats().pages} pages`);
        })
      : () => undefined;

    const server = createServer({
      store,
      name: config.name,
      ...(config.about !== undefined ? { about: config.about } : {}),
    });
    const transport = new StdioServerTransport();
    const shutdown = (): void => {
      stop();
      void server.close().finally(() => process.exit(0));
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    await server.connect(transport);
  },
  parameters: {
    flags: {
      ...commonFlags,
      watch: {
        kind: 'boolean',
        brief: 'Re-index when files under the docs directory change',
        default: true,
      },
    },
  },
  docs: { brief: 'Run the MCP server over stdio' },
});

const serveCommand = buildCommand({
  func: async (flags: CommonFlags & { port: number; watch: boolean }): Promise<void> => {
    const { config, store } = await loadStore(flags);
    log(`indexed ${store.stats().pages} pages from ${config.docsDir}`);
    if (flags.watch) {
      store.watch((err) => {
        if (err) log(`reindex failed: ${err.message}`);
        else log(`reindexed: ${store.stats().pages} pages`);
      });
    }
    const httpHandler = createHandler({ store });
    const server = http.createServer((req, res) => {
      void httpHandler(req, res);
    });
    server.listen(flags.port, () => {
      log(`MCP endpoint: http://localhost:${flags.port}/mcp`);
    });
  },
  parameters: {
    flags: {
      ...commonFlags,
      port: { kind: 'parsed', parse: numberParser, brief: 'Port to listen on', default: '3000' },
      watch: {
        kind: 'boolean',
        brief: 'Re-index when files under the docs directory change',
        default: true,
      },
    },
  },
  docs: { brief: 'Run the MCP server over Streamable HTTP' },
});

const auditCommand = buildCommand({
  func: async (
    flags: CommonFlags & { 'stale-days': number; 'min-words': number; 'max-section-words': number; json: boolean },
  ): Promise<void> => {
    const { store } = await loadStore(flags);
    const report = auditDocs(store, {
      staleDays: flags['stale-days'],
      minWords: flags['min-words'],
      maxSectionWords: flags['max-section-words'],
    });
    process.stdout.write(`${flags.json ? JSON.stringify(report, null, 2) : formatAuditReport(report)}\n`);
    process.exitCode = report.summary.errors > 0 ? 1 : 0;
  },
  parameters: {
    flags: {
      ...commonFlags,
      'stale-days': { kind: 'parsed', parse: numberParser, brief: 'Flag pages older than this', default: '180' },
      'min-words': { kind: 'parsed', parse: numberParser, brief: 'Flag pages shorter than this', default: '50' },
      'max-section-words': {
        kind: 'parsed',
        parse: numberParser,
        brief: 'Flag sections longer than this with no sub-headings',
        default: '1500',
      },
      json: { kind: 'boolean', brief: 'Print the report as JSON', default: false },
    },
  },
  docs: { brief: 'Audit the docs for completeness, freshness and structure (exit 1 on errors)' },
});

const searchCommand = buildCommand({
  func: async (flags: CommonFlags & { limit: number }, query: string): Promise<void> => {
    const { store } = await loadStore(flags);
    const hits = store.search(query, { limit: flags.limit });
    if (hits.length === 0) {
      process.stdout.write(`No results for "${query}"\n`);
      return;
    }
    for (const h of hits) {
      const ref = h.anchor ? `${h.path}#${h.anchor}` : h.path;
      process.stdout.write(`${h.score.toFixed(2)}  ${ref}\n      ${h.title}${h.heading ? ` › ${h.heading}` : ''}\n      ${h.snippet}\n\n`);
    }
  },
  parameters: {
    flags: {
      ...commonFlags,
      limit: { kind: 'parsed', parse: numberParser, brief: 'Max results', default: '8' },
    },
    positional: {
      kind: 'tuple',
      parameters: [{ brief: 'Search query', parse: String, placeholder: 'query' }],
    },
  },
  docs: { brief: 'Search the docs from the terminal' },
});

const app = buildApplication(
  buildRouteMap({
    routes: { start: startCommand, serve: serveCommand, audit: auditCommand, search: searchCommand },
    docs: { brief: 'MCP server that lets agents search and read your docs at query time' },
  }),
  { name: 'docs-mcp' },
);

export const runCli = (argv: string[] = process.argv.slice(2)): Promise<void> =>
  run(app, argv, { process: process as unknown as Parameters<typeof run>[2]['process'] });

export const isCliEntrypoint = (): boolean => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (isCliEntrypoint()) {
  void runCli();
}
