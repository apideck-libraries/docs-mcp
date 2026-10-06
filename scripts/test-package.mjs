// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const source = process.cwd();
const retained = process.argv[2] && path.resolve(process.argv[2]);
if (retained) await mkdir(retained, { recursive: true });
const root = await mkdtemp(path.join(retained || os.tmpdir(), 'docs-mcp-package-'));
const run = async (command, args, cwd, log) => {
  try {
    const result = await exec(command, args, { cwd, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    await writeFile(path.join(root, log), result.stdout + result.stderr);
    return result.stdout;
  } catch (error) {
    await writeFile(path.join(root, log), (error.stdout ?? '') + (error.stderr ?? '') + String(error));
    throw error;
  }
};

try {
  assert.equal((await run('pnpm', ['--version'], source, 'pnpm-version.log')).trim(), '9.15.4');
  await run('pnpm', ['pack', '--pack-destination', root], source, 'pack.log');
  const archives = (await readdir(root)).filter((name) => name.endsWith('.tgz'));
  assert.equal(archives.length, 1);
  const tarball = path.join(root, archives[0]);
  const consumer = path.join(root, 'consumer');
  await mkdir(consumer);
  await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ name: 'docs-mcp-clean-consumer', version: '1.0.0', private: true, type: 'module' }, null, 2));
  await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], consumer, 'consumer-install.log');
  const graph = JSON.parse(await run('npm', ['ls', '--all', '--json'], consumer, 'consumer-graph.json'));
  const adapters = [], honos = [], sdkNodes = [];
  const inspect = (node) => {
    for (const [name, entry] of Object.entries(node.dependencies ?? {})) {
      if (name === '@hono/node-server') adapters.push(entry.version);
      if (name === 'hono') honos.push(entry.version);
      if (name === '@modelcontextprotocol/node') sdkNodes.push(entry.version);
      inspect(entry);
    }
  };
  inspect(graph);
  assert.ok(adapters.length > 0);
  assert.deepEqual([...new Set(adapters)], ['2.1.3']);
  assert.deepEqual([...new Set(honos)], ['4.13.13']);
  assert.deepEqual(sdkNodes, []);
  const manifest = JSON.parse(await readFile(path.join(consumer, 'package.json'), 'utf8'));
  assert.equal(manifest.overrides, undefined);
  assert.equal(manifest.resolutions, undefined);
  assert.equal(manifest.pnpm, undefined);
  const installed = JSON.parse(await readFile(path.join(consumer, 'node_modules/@apideck/docs-mcp/package.json'), 'utf8'));
  assert.equal(installed.dependencies['@modelcontextprotocol/node'], undefined);
  assert.equal(installed.dependencies['@hono/node-server'], '2.1.3');
  assert.equal(installed.dependencies.hono, '4.13.13');
  for (const name of ['http-runtime.mjs', 'stdio-runtime.mjs']) await copyFile(path.join(source, 'test/fixtures', name), path.join(consumer, name));
  const runtimeLog = await run(process.execPath, ['--test', '--test-reporter=tap', 'http-runtime.mjs', 'stdio-runtime.mjs'], consumer, 'consumer-runtime.log');
  const runtimeTests = Number(runtimeLog.match(/# tests (\d+)/)?.[1]);
  assert.ok(runtimeTests > 0);
  assert.match(runtimeLog, /# fail 0\b/);

  // A separate type-only consumer declares the old SDK Node package itself.
  // Its dev graph is intentionally distinct from the clean shipped-runtime proof.
  const compatibility = path.join(root, 'factory-compatibility');
  await mkdir(compatibility);
  await writeFile(path.join(compatibility, 'package.json'), JSON.stringify({ name: 'docs-mcp-factory-compatibility', version: '1.0.0', private: true, type: 'module' }, null, 2));
  await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball, '@modelcontextprotocol/node@2.1.0', '@modelcontextprotocol/server@2.2.0', 'typescript@5.8.3', '@types/node@20.19.43'], compatibility, 'factory-install.log');
  await copyFile(path.join(source, 'test/fixtures/public-api.ts'), path.join(compatibility, 'public-api.ts'));
  await writeFile(path.join(compatibility, 'factory.ts'), `import { NodeStreamableHTTPServerTransport as SdkNodeTransport } from '@modelcontextprotocol/node';
import { NodeStreamableHTTPServerTransport, createHttpHandler, DocStore } from '@apideck/docs-mcp';
import type { HttpHandlerOptions, NodeHttpTransport } from '@apideck/docs-mcp';
const store = new DocStore({ root: './docs' });
const original: HttpHandlerOptions = { store, transportFactory: () => new SdkNodeTransport({ enableJsonResponse: true }) };
const owned: NodeHttpTransport = new NodeStreamableHTTPServerTransport({ enableJsonResponse: true });
createHttpHandler(original);
createHttpHandler({ store, transportFactory: () => owned });
`);
  await writeFile(path.join(compatibility, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, exactOptionalPropertyTypes: true, noEmit: true, module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', skipLibCheck: true }, include: ['*.ts'] }));
  await run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], compatibility, 'factory-typecheck.log');
  const result = { version: installed.version, tarball, adapters: [...new Set(adapters)], hono: [...new Set(honos)], sdkNodeRuntime: sdkNodes, consumerOverrides: false, runtimeTests, originalFactoryTypecheck: 'passed' };
  await writeFile(path.join(root, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (!retained) await rm(root, { recursive: true, force: true });
  else console.log(`Package evidence retained at ${root}`);
}
