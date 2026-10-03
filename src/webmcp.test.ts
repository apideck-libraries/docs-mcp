// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { createHttpHandler } from './http.js';
import { DocStore } from './store.js';
import type { ToolCallEvent } from './types.js';
import { registerDocsTools } from './webmcp.js';
import type { ModelContext, WebMcpTool } from './webmcp.js';

const fakeModelContext = (): ModelContext & { tools: Map<string, WebMcpTool> } => {
  const tools = new Map<string, WebMcpTool>();
  return {
    tools,
    registerTool: (tool, opts) => {
      tools.set(tool.name, tool);
      opts?.signal?.addEventListener('abort', () => tools.delete(tool.name));
    },
  };
};

describe('registerDocsTools (WebMCP bridge) and onToolCall', () => {
  let server: http.Server;
  let endpoint: string;
  const events: ToolCallEvent[] = [];

  before(async () => {
    const store = new DocStore({ root: path.resolve('docs'), baseUrl: 'https://docs.example.com' });
    const handler = createHttpHandler({ store, onToolCall: (e) => void events.push(e) });
    server = http.createServer((req, res) => {
      void handler(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  });
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  beforeEach(() => {
    events.length = 0;
  });

  it('is a no-op when WebMCP is unavailable', async () => {
    const reg = await registerDocsTools({ endpoint });
    assert.deepEqual(reg.tools, []);
  });

  it('registers the server tools plus read_current_page, read-only', async () => {
    const mc = fakeModelContext();
    const reg = await registerDocsTools({ endpoint, modelContext: mc, location: { href: 'https://docs.example.com/tools' } });
    assert.deepEqual(reg.tools, ['search_docs', 'get_doc', 'list_docs', 'read_current_page']);
    for (const tool of mc.tools.values()) assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal((mc.tools.get('search_docs')?.inputSchema['properties'] as Record<string, unknown>)['query'] !== undefined, true);
    reg.unregister();
    assert.equal(mc.tools.size, 0);
  });

  it('forwards calls to the server and tags them as webmcp', async () => {
    const mc = fakeModelContext();
    await registerDocsTools({ endpoint, modelContext: mc, currentPageTool: false });
    const out = await mc.tools.get('search_docs')!.execute({ query: 'vercel' });
    assert.match(out, /result\(s\) for "vercel"/);
    const event = events.find((e) => e.tool === 'search_docs');
    assert.equal(event?.client, 'webmcp');
    assert.equal(event?.isError, false);
    assert.ok((event?.resultCount ?? 0) > 0);
    assert.ok(event?.userAgent);
  });

  it('reports zero-result searches', async () => {
    const mc = fakeModelContext();
    await registerDocsTools({ endpoint, modelContext: mc, currentPageTool: false });
    const out = await mc.tools.get('search_docs')!.execute({ query: 'zzqxwv' });
    assert.match(out, /No results/);
    assert.equal(events.find((e) => e.tool === 'search_docs')?.resultCount, 0);
  });

  it('read_current_page returns the page at location.href', async () => {
    const mc = fakeModelContext();
    await registerDocsTools({ endpoint, modelContext: mc, location: { href: 'https://docs.example.com/tools' } });
    const out = await mc.tools.get('read_current_page')!.execute({});
    assert.match(out, /path: tools/);
    assert.equal(events.find((e) => e.tool === 'get_doc')?.args['path'], 'https://docs.example.com/tools');
  });

  it('returns error results as text and reports them', async () => {
    const mc = fakeModelContext();
    await registerDocsTools({ endpoint, modelContext: mc, currentPageTool: false });
    const out = await mc.tools.get('get_doc')!.execute({ path: 'no/such/page' });
    assert.match(out, /^Error: No page at "no\/such\/page"/);
    assert.equal(events.find((e) => e.tool === 'get_doc')?.isError, true);
  });

  it('only registers the requested tools', async () => {
    const mc = fakeModelContext();
    const reg = await registerDocsTools({ endpoint, modelContext: mc, tools: ['search_docs'], currentPageTool: false });
    assert.deepEqual(reg.tools, ['search_docs']);
  });

  it('a throwing hook does not break the call', async () => {
    const store = new DocStore({ root: path.resolve('docs') });
    const handler = createHttpHandler({
      store,
      onToolCall: () => {
        throw new Error('sink down');
      },
    });
    const s = http.createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) => s.listen(0, resolve));
    try {
      const mc = fakeModelContext();
      await registerDocsTools({
        endpoint: `http://127.0.0.1:${(s.address() as AddressInfo).port}/mcp`,
        modelContext: mc,
        currentPageTool: false,
      });
      assert.match(await mc.tools.get('list_docs')!.execute({}), /page\(s\)/);
    } finally {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });
});
