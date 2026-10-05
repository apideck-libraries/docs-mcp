// SPDX-License-Identifier: MIT

/**
 * Stateless Streamable HTTP handler over Node's request/response objects.
 * Works as a Vercel function, a Next.js API route, or behind `http.createServer`.
 * GET returns a JSON summary of the index; POST speaks MCP; each POST gets a
 * fresh McpServer bound to the shared DocStore.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';

import { createServer } from './server.js';
import type { DocStore } from './store.js';
import type { AnyToolDefinition, ToolCallHook } from './types.js';

export interface HttpHandlerOptions {
  /** Store to serve, or a function returning one (called per request, so it can lazy-load and cache). */
  store: DocStore | (() => Promise<DocStore>);
  name?: string;
  version?: string;
  /** One-line description of what the docs cover, shown to agents and in the GET summary. */
  about?: string;
  /** Host-specific guidance appended to the server instructions. See `CreateServerOptions.instructions`. */
  instructions?: string;
  /**
   * Extra tools registered alongside search_docs/get_doc/list_docs, or a
   * function returning them (called per request, so it can depend on the
   * same lazily-loaded data as a `store` function). See
   * `CreateServerOptions.extraTools`.
   */
  extraTools?: AnyToolDefinition[] | (() => Promise<AnyToolDefinition[]>);
  /**
   * Called after every tool call with the tool, arguments, timing, result
   * count and caller (`X-MCP-Client` header, User-Agent). See `ToolCallHook`.
   */
  onToolCall?: ToolCallHook;
  /** Extra fields merged into the GET summary. */
  info?: Record<string, unknown>;
  /** Set to false to skip CORS headers (e.g. when a gateway adds them). Default true. */
  cors?: boolean;
  transportFactory?: () => NodeStreamableHTTPServerTransport;
}

export type NodeHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

const CORS_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['Access-Control-Allow-Origin', '*'],
  ['Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS'],
  ['Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Authorization, X-MCP-Client'],
  ['Access-Control-Expose-Headers', 'Mcp-Session-Id'],
];

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

const header = (req: IncomingMessage, name: string): string | undefined => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

const callerOf = (req: IncomingMessage): { client?: string; userAgent?: string } => {
  const client = header(req, 'x-mcp-client');
  const userAgent = header(req, 'user-agent');
  return {
    ...(client !== undefined ? { client } : {}),
    ...(userAgent !== undefined ? { userAgent } : {}),
  };
};

export const createHttpHandler = (opts: HttpHandlerOptions): NodeHandler => {
  const getStore = async (): Promise<DocStore> => {
    if (typeof opts.store === 'function') return opts.store();
    await opts.store.load();
    return opts.store;
  };

  const getExtraTools = async (): Promise<AnyToolDefinition[]> => {
    if (!opts.extraTools) return [];
    return typeof opts.extraTools === 'function' ? opts.extraTools() : opts.extraTools;
  };

  return async (req, res) => {
    if (opts.cors !== false) for (const [k, v] of CORS_HEADERS) res.setHeader(k, v);
    const method = req.method ?? 'GET';

    if (method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    let store: DocStore;
    try {
      store = await getStore();
    } catch (err) {
      json(res, 500, { error: `Failed to index docs: ${String(err)}` });
      return;
    }

    if (method === 'GET') {
      const stats = store.stats();
      const extraTools = await getExtraTools();
      json(res, 200, {
        name: opts.name ?? 'docs-mcp',
        description: opts.about ?? 'Read-only MCP server over a documentation set.',
        transport: 'streamable-http',
        tools: ['search_docs', 'get_doc', 'list_docs', ...extraTools.map((t) => t.name)],
        pages: stats.pages,
        sections: stats.sections,
        indexed_at: stats.indexedAt?.toISOString() ?? null,
        version: opts.version ?? process.env['npm_package_version'] ?? '0.0.0',
        ...opts.info,
      });
      return;
    }

    if (method !== 'POST') {
      json(res, 405, { error: 'Method not allowed' });
      return;
    }

    const extraTools = await getExtraTools();
    const server = createServer({
      store,
      ...(opts.name !== undefined ? { name: opts.name } : {}),
      ...(opts.version !== undefined ? { version: opts.version } : {}),
      ...(opts.about !== undefined ? { about: opts.about } : {}),
      ...(opts.instructions !== undefined ? { instructions: opts.instructions } : {}),
      ...(extraTools.length > 0 ? { extraTools } : {}),
      ...(opts.onToolCall !== undefined ? { onToolCall: opts.onToolCall, caller: callerOf(req) } : {}),
    });
    const transport = (opts.transportFactory ?? (() => new NodeStreamableHTTPServerTransport({})))();
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, (req as IncomingMessage & { body?: unknown }).body);
  };
};
