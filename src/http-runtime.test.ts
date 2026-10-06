// SPDX-License-Identifier: MIT

import { execFile } from 'node:child_process';
import path from 'node:path';
import { it } from 'node:test';
import { promisify } from 'node:util';

it('satisfies the real public HTTP runtime and adapter security contract', { timeout: 30_000 }, async () => {
  const result = await promisify(execFile)(process.execPath, ['--test', path.resolve('test/fixtures/http-runtime.mjs')], { timeout: 25_000 });
  console.log(result.stdout);
});
