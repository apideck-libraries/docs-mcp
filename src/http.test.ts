// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { z } from 'zod';

import { createHttpHandler } from './http.js';
import { DocStore } from './store.js';
import { toolResult } from './tools.js';
import type { ToolDefinition } from './types.js';

const schema = {
  value: z.string().trim().min(1).transform((value) => value.toUpperCase()),
  count: z.number().int().min(1).max(3).default(2),
  fail: z.boolean().optional(),
};

describe('createHttpHandler with extraTools', () => {
  let server: http.Server;
  let baseUrl: string;
  let calls = 0;
  let resolutions = 0;
  let loads = 0;
  let transports = 0;
  let parsedBodies = 0;

  before(async () => {
    const store = new DocStore({
      root: path.resolve('docs'),
      baseUrl: 'https://example.com',
      metadata: (docPath) => docPath === 'tools'
        ? { title: 'Canonical tools', description: 'From manifest', url: 'https://example.com/ref#tools' }
        : undefined,
    });
    let cached: Promise<DocStore> | undefined;
    const echo: ToolDefinition<typeof schema> = {
      name: 'echo_thing',
      title: 'Echo thing',
      description: 'Echoes its validated input.',
      inputSchema: schema,
      annotations: { readOnlyHint: true },
      handler: async ({ value, count, fail }) => {
        calls += 1;
        return toolResult(`echo: ${value.repeat(count)}`, { value, count }, fail);
      },
    };
    const handler = createHttpHandler({
      store: () => cached ??= (async () => { loads += 1; await store.load(); return store; })(),
      extraTools: async () => { resolutions += 1; return [echo]; },
      transportFactory: () => { transports += 1; return new NodeStreamableHTTPServerTransport({}); },
    });
    server = http.createServer((req, res) => {
      void (async () => {
        // Simulate a framework consuming the stream before passing req.body.
        if (req.url === '/parsed' && req.method === 'POST') {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          Object.assign(req, { body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
          parsedBodies += 1;
        }
        await handler(req, res);
      })().catch((error: unknown) => {
        res.statusCode = 500;
        res.end(String(error));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const withClient = async (run: (client: Client) => Promise<void>, route = '/mcp'): Promise<void> => {
    const client = new Client({ name: 'http-extra-tools-test', version: '0' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}${route}`)));
      await run(client);
    } finally {
      await client.close();
    }
  };

  it('lists the extra tool name in the GET summary', async () => {
    const body = await (await fetch(`${baseUrl}/mcp`)).json() as { tools: string[] };
    assert.deepEqual(body.tools, ['search_docs', 'get_doc', 'list_docs', 'echo_thing']);
  });

  it('resolves extraTools fresh on each POST and validates/transforms actual calls', async () => {
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      const input = tools.find((tool) => tool.name === 'echo_thing')?.inputSchema;
      assert.ok(input);
      assert.equal(input.type, 'object');
      assert.deepEqual(input.required, ['value']);
      const before = resolutions;
      const result = await client.callTool({ name: 'echo_thing', arguments: { value: ' hi ', ignored: 'extra' } });
      assert.deepEqual(result, {
        content: [{ type: 'text', text: 'echo: HIHI' }],
        structuredContent: { value: 'HI', count: 2 },
      });
      assert.equal(resolutions, before + 1);
      const error = await client.callTool({ name: 'echo_thing', arguments: { value: 'ok', count: 1, fail: true } });
      assert.equal(error.isError, true);
      assert.deepEqual(error.structuredContent, { value: 'OK', count: 1 });
    });
  });

  it('rejects invalid custom arguments before invoking the host handler', async () => {
    await withClient(async (client) => {
      const before = calls;
      for (const args of [{ value: 42 }, { value: '  ' }, { value: 'ok', count: 4 }]) {
        const result = await client.callTool({ name: 'echo_thing', arguments: args });
        assert.equal(result.isError, true);
      }
      assert.equal(calls, before);
    });
  });

  it('preserves metadata and section URLs through consumed Node parsedBody requests', async () => {
    await withClient(async (client) => {
      const canonical = await client.callTool({ name: 'get_doc', arguments: { path: 'https://example.com/ref#tools', section: 'search_docs' } });
      assert.equal(z.object({ url: z.string() }).parse(canonical.structuredContent).url, 'https://example.com/ref#tools');
      assert.match(JSON.stringify(canonical.content), /Canonical tools/);
      assert.match(JSON.stringify(canonical.content), /From manifest/);
      const section = await client.callTool({ name: 'get_doc', arguments: { path: 'https://example.com/hosting#vercel' } });
      assert.deepEqual(z.object({ url: z.string(), section: z.string() }).parse(section.structuredContent), {
        url: 'https://example.com/hosting#vercel', section: 'vercel',
      });
      assert.match(JSON.stringify((await client.readResource({ uri: 'docs://tools' })).contents), /search_docs/);
      assert.ok(parsedBodies >= 4);
      assert.equal(loads, 1);
      assert.ok(transports > 0);
    }, '/parsed');
  });

  for (const revision of ['2024-10-07', '2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']) {
    it(`keeps the ordinary ${revision} initialization handshake`, async () => {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
          protocolVersion: revision, capabilities: {}, clientInfo: { name: 'revision-test', version: '0' },
        } }),
      });
      assert.equal(response.status, 200);
      const data = (await response.text()).split('\n').find((line) => line.startsWith('data: '));
      assert.ok(data);
      const message = JSON.parse(data.slice(6)) as { result: { protocolVersion: string } };
      assert.equal(message.result.protocolVersion, revision);
    });
  }

  it('applies the SDK default 4 MiB HTTP limit when it reads the body', async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { note: 'x'.repeat(4 * 1024 * 1024) } } }),
    });
    assert.equal(response.status, 413);
    await response.text();
  });
});
