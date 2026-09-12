// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { DocStore } from '../src/store.js';
import { createHandler } from './mcp.js';

describe('Streamable HTTP handler', () => {
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    const store = new DocStore({ root: path.resolve('docs') });
    const handler = createHandler({ store });
    server = http.createServer((req, res) => {
      void handler(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('GET returns an index summary with CORS headers', async () => {
    const res = await fetch(`${baseUrl}/mcp`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    const body = (await res.json()) as { pages: number; tools: string[]; endpoint: string };
    assert.ok(body.pages >= 5);
    assert.deepEqual(body.tools, ['search_docs', 'get_doc', 'list_docs']);
    assert.equal(body.endpoint, '/mcp');
  });

  it('OPTIONS preflight returns 204 and PUT is rejected', async () => {
    assert.equal((await fetch(`${baseUrl}/mcp`, { method: 'OPTIONS' })).status, 204);
    assert.equal((await fetch(`${baseUrl}/mcp`, { method: 'PUT' })).status, 405);
  });

  it('serves MCP tool calls to a Streamable HTTP client', async () => {
    const client = new Client({ name: 'http-test', version: '0.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    await client.connect(transport as Parameters<typeof client.connect>[0]);
    try {
      const { tools } = await client.listTools();
      assert.equal(tools.length, 3);
      const result = await client.callTool({ name: 'search_docs', arguments: { query: 'audit stale' } });
      const structured = result.structuredContent as { results: Array<{ path: string }> };
      assert.equal(structured.results[0]?.path, 'auditing');
    } finally {
      await client.close();
    }
  });
});
