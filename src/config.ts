// SPDX-License-Identifier: MIT

import path from 'node:path';

import { DocStore } from './store.js';

export interface DocsConfig {
  docsDir: string;
  baseUrl: string | undefined;
  about: string | undefined;
  name: string;
}

/** Resolve settings from flags, falling back to DOCS_DIR / DOCS_BASE_URL / DOCS_ABOUT / DOCS_NAME. */
export const resolveConfig = (overrides: Partial<DocsConfig> = {}): DocsConfig => ({
  docsDir: path.resolve(overrides.docsDir ?? process.env['DOCS_DIR'] ?? 'docs'),
  baseUrl: overrides.baseUrl ?? process.env['DOCS_BASE_URL'] ?? undefined,
  about: overrides.about ?? process.env['DOCS_ABOUT'] ?? undefined,
  name: overrides.name ?? process.env['DOCS_NAME'] ?? 'docs-mcp',
});

export const createStore = (config: DocsConfig): DocStore =>
  new DocStore({ root: config.docsDir, ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}) });
