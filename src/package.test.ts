// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { it } from 'node:test';
import { promisify } from 'node:util';

import yaml from 'js-yaml';

const exec = promisify(execFile);

it('publishes declarations usable by custom tools and the current SDK transport', async () => {
  await exec(process.execPath, [path.resolve('node_modules/typescript/bin/tsc'), '-p', 'test/tsconfig.json']);
});

it('keeps SDK v1 and its parser chain out of the entire lockfile, including development dependencies', async () => {
  const lock = yaml.load(await readFile('pnpm-lock.yaml', 'utf8')) as { packages: Record<string, unknown> };
  assert.ok(Object.keys(lock.packages).length > 0);
  const forbidden = /^(?:@modelcontextprotocol\/(?:sdk|server-legacy)|raw-body|express|body-parser)@/;
  assert.deepEqual(Object.keys(lock.packages).filter((name) => forbidden.test(name)), []);
});
