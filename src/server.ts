// SPDX-License-Identifier: MIT

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { DocStore } from './store.js';
import { createDocTools } from './tools.js';
import type { AnyToolDefinition, ToolCallEvent, ToolCallHook, ToolResult } from './types.js';

export interface CreateServerOptions {
  store: DocStore;
  name?: string;
  version?: string;
  /** Short description of what the docs cover, shown to agents in server instructions. */
  about?: string;
  /**
   * Extra tools registered alongside search_docs/get_doc/list_docs, for
   * host-specific lookups over data the docs already carry (an API
   * operation index, a connector coverage matrix, ...). Build them with
   * `toolResult()` for a result shape consistent with the built-in tools.
   */
  extraTools?: AnyToolDefinition[];
  /** Called after every tool call, e.g. to log queries and find ones the docs can't answer. */
  onToolCall?: ToolCallHook;
  /** Caller details from the transport (the HTTP handler fills these from request headers). */
  caller?: { client?: string; userAgent?: string };
}

const instructionsFor = (about: string | undefined, extraTools: AnyToolDefinition[]): string =>
  [
    `This server exposes ${about ?? 'a documentation set'} as read-only, always-current content.`,
    'Prefer it over training data when answering questions about this product.',
    'Workflow: call search_docs with a few specific terms, then get_doc on the best path (optionally with a section anchor) to read the actual text before answering.',
    'Use list_docs to browse structure when a search returns nothing useful.',
    extraTools.length > 0
      ? `Additional tools for this documentation set: ${extraTools.map((t) => t.name).join(', ')}.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

const resultCount = (result: ToolResult): number | undefined => {
  const s = result.structuredContent;
  const list = s?.['results'] ?? s?.['pages'];
  return Array.isArray(list) ? list.length : undefined;
};

const report = (hook: ToolCallHook, event: ToolCallEvent): void => {
  try {
    void Promise.resolve(hook(event)).catch(() => undefined);
  } catch {
    // A failing hook must never affect the tool call.
  }
};

const withReporting =
  (
    server: McpServer,
    tool: AnyToolDefinition,
    hook: ToolCallHook,
    caller: CreateServerOptions['caller'],
  ): AnyToolDefinition['handler'] =>
  async (args: Record<string, unknown>) => {
    const started = performance.now();
    const client = caller?.client ?? server.server.getClientVersion()?.name;
    const base = {
      tool: tool.name,
      args,
      ...(client !== undefined ? { client } : {}),
      ...(caller?.userAgent !== undefined ? { userAgent: caller.userAgent } : {}),
    };
    try {
      const result = await tool.handler(args);
      const count = resultCount(result);
      report(hook, {
        ...base,
        isError: result.isError === true,
        durationMs: performance.now() - started,
        ...(count !== undefined ? { resultCount: count } : {}),
      });
      return result;
    } catch (err) {
      report(hook, {
        ...base,
        isError: true,
        durationMs: performance.now() - started,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };

export const createServer = (opts: CreateServerOptions): McpServer => {
  const extraTools = opts.extraTools ?? [];
  const server = new McpServer(
    { name: opts.name ?? 'docs-mcp', version: opts.version ?? process.env['npm_package_version'] ?? '0.0.0' },
    { capabilities: { tools: {}, resources: {} }, instructions: instructionsFor(opts.about, extraTools) },
  );

  for (const tool of [...createDocTools(opts.store), ...extraTools]) {
    const handler = opts.onToolCall ? withReporting(server, tool, opts.onToolCall, opts.caller) : tool.handler;
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: z.object(tool.inputSchema),
        annotations: tool.annotations,
      },
      async (args) => ({ ...(await handler(args)) }),
    );
  }

  server.registerResource(
    'doc',
    new ResourceTemplate('docs://{+path}', {
      list: async () => ({
        resources: opts.store.listPages().map((p) => ({
          uri: `docs://${p.path}`,
          name: p.title,
          mimeType: 'text/markdown',
          ...(p.description !== undefined ? { description: p.description } : {}),
        })),
      }),
    }),
    { title: 'Documentation page', description: 'Markdown source of one documentation page.', mimeType: 'text/markdown' },
    async (uri, variables) => {
      const raw = variables['path'];
      const ref = Array.isArray(raw) ? raw.join('/') : (raw ?? '');
      const page = opts.store.get(ref);
      if (!page) throw new Error(`No page at ${uri.href}`);
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: page.body.trim() }] };
    },
  );

  return server;
};
