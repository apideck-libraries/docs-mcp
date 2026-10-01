// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { it } from 'node:test';
import { promisify } from 'node:util';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const exec = promisify(execFile);
const cli = path.resolve('dist/bin/docs-mcp.js');
const docs = path.resolve('docs');
const args = [cli];

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

it('serves HTTP through the compiled serve command', { timeout: 15_000 }, async () => {
  // The CLI has no host flag: contain its listener to loopback in this fixture.
  const child = spawn(process.execPath, [
    '--import', path.resolve('test/fixtures/loopback-only.mjs'), cli,
    'serve', '--docs', docs, '--port', '0', '--watch=false',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  const client = new Client({ name: 'compiled-serve-test', version: '0' });
  try {
    const port = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CLI did not start: ${stderr}`)), 10_000);
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
        const match = stderr.match(/FIXTURE_PORT=(\d+)/);
        if (match?.[1]) { clearTimeout(timer); resolve(match[1]); }
      });
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`CLI exited ${code}: ${stderr}`)); });
    });
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    assert.equal((await client.listTools()).tools.length, 3);
    const result = await client.callTool({ name: 'get_doc', arguments: { path: 'hosting' } });
    assert.match(JSON.stringify(result.content), /Vercel/);
  } finally {
    await client.close();
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
  }
});
