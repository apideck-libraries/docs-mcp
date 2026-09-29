// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { it } from 'node:test';
import { promisify } from 'node:util';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const exec = promisify(execFile);
const cli = path.resolve('bin/docs-mcp.ts');
const docs = path.resolve('docs');
const args = ['--import', 'tsx', cli];

it('serves tools and resources through the standalone stdio CLI', { timeout: 15_000 }, async () => {
  const client = new Client({ name: 'cli-test', version: '0.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [...args, 'start', '--docs', docs, '--watch=false'],
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name), ['search_docs', 'get_doc', 'list_docs']);
    const search = await client.callTool({ name: 'search_docs', arguments: { query: 'audit stale' } });
    const results = search.structuredContent as { results: Array<{ path: string }> };
    assert.equal(results.results[0]?.path, 'auditing');
    const doc = await client.callTool({ name: 'get_doc', arguments: { path: 'hosting', section: '#vercel' } });
    assert.ok(!doc.isError);
    assert.match(JSON.stringify(doc.content), /Vercel/);
    const { resources } = await client.listResources();
    const resource = resources.find((item) => item.uri === 'docs://hosting');
    assert.ok(resource);
    const read = await client.readResource({ uri: resource.uri });
    assert.match(JSON.stringify(read.contents), /Vercel/);
  } finally {
    await client.close();
    await transport.close();
  }
});

it('runs standalone search and audit commands', { timeout: 15_000 }, async () => {
  const search = await exec(process.execPath, [...args, 'search', 'vercel', '--docs', docs], { timeout: 10_000 });
  assert.match(search.stdout, /hosting/);
  const audit = await exec(process.execPath, [...args, 'audit', '--docs', docs, '--json'], { timeout: 10_000 });
  const report = JSON.parse(audit.stdout) as { summary: { errors: number } };
  assert.equal(report.summary.errors, 0);
});
