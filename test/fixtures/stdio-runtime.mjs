// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.resolve('@apideck/docs-mcp/package.json'));
const pkg = require('@apideck/docs-mcp/package.json');
const cli = path.resolve(path.dirname(require.resolve('@apideck/docs-mcp/package.json')), pkg.bin['docs-mcp']);

it('runs the installed CLI and real stdio JSON-RPC with missing-document recovery', { timeout: 15_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'docs-mcp-stdio-'));
  await writeFile(path.join(root, 'guide.md'), '# Runtime guide\n\nRecover after a missing document.');
  const child = spawn(process.execPath, [cli, 'start', '--docs', root, '--watch=false'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let buffered = '', stderr = '', nextId = 0;
  child.stderr.on('data', (data) => { stderr += data; });
  child.stdout.on('data', (data) => {
    buffered += data;
    for (;;) {
      const newline = buffered.indexOf('\n');
      if (newline < 0) break;
      const message = JSON.parse(buffered.slice(0, newline));
      buffered = buffered.slice(newline + 1);
      pending.get(message.id)?.(message);
    }
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => reject(new Error(`stdio timed out: ${method}; ${stderr}`)), 5_000);
    pending.set(id, (message) => { clearTimeout(timer); pending.delete(id); resolve(message); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  try {
    const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'clean-consumer', version: '0' } });
    assert.equal(init.result.protocolVersion, '2025-03-26');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    assert.deepEqual((await rpc('tools/list', {})).result.tools.map((tool) => tool.name), ['search_docs', 'get_doc', 'list_docs']);
    const missing = await rpc('tools/call', { name: 'get_doc', arguments: { path: 'missing' } });
    assert.equal(missing.result.isError, true);
    assert.equal(missing.result.structuredContent.found, false);
    const recovered = await rpc('tools/call', { name: 'get_doc', arguments: { path: 'guide' } });
    assert.equal(recovered.error, undefined);
    assert.match(recovered.result.structuredContent.content, /Recover after a missing document/);
    assert.match((await rpc('resources/read', { uri: 'docs://guide' })).result.contents[0].text, /Runtime guide/);
    const exec = promisify(execFile);
    assert.match((await exec(process.execPath, [cli, 'search', 'recover', '--docs', root])).stdout, /guide/);
    assert.equal(JSON.parse((await exec(process.execPath, [cli, 'audit', '--docs', root, '--json'])).stdout).summary.errors, 0);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  }
});
