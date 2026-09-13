// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';

import { createServer } from './server.js';
import { DocStore } from './store.js';
import { toolResult } from './tools.js';
import type { AnyToolDefinition } from './types.js';

const textOf = (result: unknown): string => {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
  return content?.[0]?.text ?? '';
};

describe('MCP server over in-memory transport', () => {
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  let store: DocStore;

  before(async () => {
    store = new DocStore({ root: path.resolve('docs'), baseUrl: 'https://example.com' });
    await store.load();
    const server = createServer({ store, about: 'the docs-mcp documentation' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });
  after(() => client.close());

  it('advertises three read-only tools and instructions', async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      ['get_doc', 'list_docs', 'search_docs'],
    );
    for (const t of tools) assert.equal(t.annotations?.readOnlyHint, true);
    assert.match(client.getInstructions() ?? '', /docs-mcp documentation/);
  });

  it('search_docs returns ranked hits with structured content', async () => {
    const result = await client.callTool({ name: 'search_docs', arguments: { query: 'vercel deploy', limit: 3 } });
    assert.notEqual(result.isError, true);
    assert.match(textOf(result), /hosting/);
    const structured = result.structuredContent as { results: Array<{ path: string }> };
    assert.equal(structured.results[0]?.path, 'hosting');
    assert.ok(structured.results.length <= 3);
  });

  it('search_docs rejects an empty query', async () => {
    const result = await client.callTool({ name: 'search_docs', arguments: { query: '' } });
    assert.equal(result.isError, true);
  });

  it('get_doc returns a whole page with header and outline', async () => {
    const result = await client.callTool({ name: 'get_doc', arguments: { path: 'tools.md' } });
    assert.notEqual(result.isError, true);
    const text = textOf(result);
    assert.match(text, /^# Tools\n\npath: tools\nurl: https:\/\/example\.com\/tools/);
    assert.match(text, /sections:\n- search_docs \(#search_docs\)/);
    assert.match(text, /## list_docs/);
  });

  it('get_doc returns a single section subtree', async () => {
    const result = await client.callTool({ name: 'get_doc', arguments: { path: 'hosting', section: '#vercel' } });
    assert.notEqual(result.isError, true);
    const text = textOf(result);
    assert.match(text, /section: #vercel/);
    assert.match(text, /## Vercel/);
    assert.match(text, /### Docs that live elsewhere/);
    assert.doesNotMatch(text, /## Local HTTP/);
  });

  it('get_doc suggests alternatives for an unknown path', async () => {
    const result = await client.callTool({ name: 'get_doc', arguments: { path: 'hostng' } });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /Did you mean:[\s\S]*hosting/);
  });

  it('get_doc resolves a full URL, using its #fragment as the section', async () => {
    const result = await client.callTool({
      name: 'get_doc',
      arguments: { path: 'https://example.com/hosting#vercel' },
    });
    assert.notEqual(result.isError, true);
    const text = textOf(result);
    assert.match(text, /section: #vercel/);
    assert.match(text, /## Vercel/);
  });

  it('get_doc falls back to the whole page when a URL fragment matches no heading', async () => {
    const result = await client.callTool({ name: 'get_doc', arguments: { path: 'https://example.com/hosting#nope' } });
    assert.notEqual(result.isError, true);
    assert.match(textOf(result), /## Local HTTP/);
  });

  it('get_doc returns an error for an unknown URL, without frontmatter-style suggestions', async () => {
    const result = await client.callTool({ name: 'get_doc', arguments: { path: 'https://example.com/nope' } });
    assert.equal(result.isError, true);
    assert.doesNotMatch(textOf(result), /Did you mean/);
  });

  it('list_docs lists pages under a prefix', async () => {
    const all = await client.callTool({ name: 'list_docs', arguments: {} });
    assert.match(textOf(all), /- getting-started: Getting started — /);
    const some = await client.callTool({ name: 'list_docs', arguments: { path_prefix: 'tools' } });
    const structured = some.structuredContent as { total: number };
    assert.equal(structured.total, 1);
  });

  it('exposes pages as docs:// resources', async () => {
    const { resources } = await client.listResources();
    assert.ok(resources.some((r) => r.uri === 'docs://getting-started' && r.name === 'Getting started'));
    const read = await client.readResource({ uri: 'docs://getting-started' });
    const first = read.contents[0] as { mimeType?: string; text?: string };
    assert.equal(first.mimeType, 'text/markdown');
    assert.match(first.text ?? '', /^# Getting started/);
  });
});

describe('MCP server with host-defined extraTools', () => {
  it('registers extra tools alongside the built-ins and mentions them in the instructions', async () => {
    const store = new DocStore({ root: path.resolve('docs') });
    await store.load();
    const echo: AnyToolDefinition = {
      name: 'echo_thing',
      title: 'Echo thing',
      description: 'Echoes its input.',
      inputSchema: { value: z.string() },
      annotations: { readOnlyHint: true },
      handler: async (args: Record<string, unknown>) => toolResult(`echo: ${String(args['value'])}`, args),
    };
    const server = createServer({ store, about: 'test docs', extraTools: [echo] });
    const client = new Client({ name: 'extra-tools-client', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    assert.match(client.getInstructions() ?? '', /Additional tools for this documentation set: echo_thing\./);
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      ['echo_thing', 'get_doc', 'list_docs', 'search_docs'],
    );
    const result = await client.callTool({ name: 'echo_thing', arguments: { value: 'hi' } });
    assert.equal(textOf(result), 'echo: hi');
    await client.close();
  });
});
