// SPDX-License-Identifier: MIT

/**
 * Vercel function: stateless Streamable HTTP endpoint at /mcp (rewritten from /api/mcp).
 * GET returns a JSON summary of the index; POST speaks MCP. The doc index is built
 * once per function instance and reused across requests.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { createStore, resolveConfig } from '../src/config.js';
import { createServer } from '../src/server.js';
import type { DocStore } from '../src/store.js';

export const config = { maxDuration: 60 };

const CORS_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['Access-Control-Allow-Origin', '*'],
  ['Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS'],
  ['Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Authorization'],
  ['Access-Control-Expose-Headers', 'Mcp-Session-Id'],
];

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

export interface CreateHandlerOpts {
  store?: DocStore;
  transportFactory?: () => StreamableHTTPServerTransport;
}

let cachedStore: Promise<DocStore> | null = null;

const getStore = (override?: DocStore): Promise<DocStore> => {
  if (override) return override.load().then(() => override);
  if (!cachedStore) {
    const store = createStore(resolveConfig());
    cachedStore = store.load().then(() => store);
    cachedStore.catch(() => {
      cachedStore = null;
    });
  }
  return cachedStore;
};

export const createHandler =
  (opts: CreateHandlerOpts = {}) =>
  async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    for (const [k, v] of CORS_HEADERS) res.setHeader(k, v);
    const method = req.method ?? 'GET';

    if (method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    let store: DocStore;
    try {
      store = await getStore(opts.store);
    } catch (err) {
      json(res, 500, { error: `Failed to index docs: ${String(err)}` });
      return;
    }
    const cfg = resolveConfig();

    if (method === 'GET') {
      const stats = store.stats();
      json(res, 200, {
        name: cfg.name,
        description: cfg.about ?? 'Read-only MCP server over a documentation set.',
        transport: 'streamable-http',
        endpoint: '/mcp',
        tools: ['search_docs', 'get_doc', 'list_docs'],
        pages: stats.pages,
        sections: stats.sections,
        indexed_at: stats.indexedAt?.toISOString() ?? null,
        version: process.env['npm_package_version'] ?? '0.1.0',
        commit_sha: process.env['VERCEL_GIT_COMMIT_SHA'] ?? null,
      });
      return;
    }

    if (method !== 'POST') {
      json(res, 405, { error: 'Method not allowed' });
      return;
    }

    const server = createServer({
      store,
      name: cfg.name,
      ...(cfg.about !== undefined ? { about: cfg.about } : {}),
    });
    const transport = (opts.transportFactory ?? (() => new StreamableHTTPServerTransport({})))();
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport as Parameters<typeof server.connect>[0]);
    await transport.handleRequest(req, res, (req as IncomingMessage & { body?: unknown }).body);
  };

export default createHandler({});
