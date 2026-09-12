// SPDX-License-Identifier: MIT

import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const TARGET = 'dist/bin/docs-mcp.js';
const SHEBANG = '#!/usr/bin/env node\n';

if (!existsSync(TARGET)) {
  console.error(`postbuild: ${TARGET} not found; run \`pnpm build\` first.`);
  process.exit(1);
}

const body = readFileSync(TARGET, 'utf8');
if (!body.startsWith('#!')) {
  writeFileSync(TARGET, SHEBANG + body, 'utf8');
}
chmodSync(TARGET, 0o755);
console.log(`postbuild: shebang + executable bit applied to ${TARGET}`);
