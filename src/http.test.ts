// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { z } from 'zod';

import { createHttpHandler } from './http.js';
import { DocStore } from './store.js';
import { toolResult } from './tools.js';
import type { AnyToolDefinition } from './types.js';

describe('createHttpHandler with extraTools', () => {
  let server: http.Server;
  let baseUrl: string;
  let calls = 0;

  before(async () => {
    const store = new DocStore({ root: path.resolve('docs') });
    const echo: AnyToolDefinition = {
      name: 'echo_thing',
      title: 'Echo thing',
      description: 'Echoes its input.',
      inputSchema: { value: z.string() },
      annotations: { readOnlyHint: true },
      handler: async (args: Record<string, unknown>) => {
        calls += 1;
        return toolResult(`echo: ${String(args['value'])}`, args);
      },
    };
    // extraTools as a function: exercises the same lazy-resolution path a
    // host would use when the tools depend on the same async setup as the
    // store (e.g. a manifest read alongside the DocStore load).
    const handler = createHttpHandler({ store, extraTools: async () => [echo] });
    server = http.createServer((req, res) => {
      void handler(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('lists the extra tool name in the GET summary', async () => {
    const res = await fetch(`${baseUrl}/mcp`);
    const body = (await res.json()) as { tools: string[] };
    assert.deepEqual(body.tools, ['search_docs', 'get_doc', 'list_docs', 'echo_thing']);
  });

  it('resolves extraTools fresh on each POST (not cached from the GET call)', async () => {
    // A bare fetch POST with a session-less JSON-RPC tools/call is enough to
    // exercise the resolver without pulling in a full MCP client.
    await fetch(`${baseUrl}/mcp`);
    const before = calls;
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
      }),
    });
    assert.equal(res.status, 200);
    assert.equal(calls, before);
  });
});
