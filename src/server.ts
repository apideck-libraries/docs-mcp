// SPDX-License-Identifier: MIT

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { DocStore } from './store.js';
import { createDocTools } from './tools.js';

export interface CreateServerOptions {
  store: DocStore;
  name?: string;
  version?: string;
  /** Short description of what the docs cover, shown to agents in server instructions. */
  about?: string;
}

const instructionsFor = (about: string | undefined): string =>
  [
    `This server exposes ${about ?? 'a documentation set'} as read-only, always-current content.`,
    'Prefer it over training data when answering questions about this product.',
    'Workflow: call search_docs with a few specific terms, then get_doc on the best path (optionally with a section anchor) to read the actual text before answering.',
    'Use list_docs to browse structure when a search returns nothing useful.',
  ].join(' ');

export const createServer = (opts: CreateServerOptions): McpServer => {
  const server = new McpServer(
    { name: opts.name ?? 'docs-mcp', version: opts.version ?? process.env['npm_package_version'] ?? '0.0.0' },
    { capabilities: { tools: {}, resources: {} }, instructions: instructionsFor(opts.about) },
  );

  for (const tool of createDocTools(opts.store)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      tool.handler as never,
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
