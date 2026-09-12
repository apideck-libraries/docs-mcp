// SPDX-License-Identifier: MIT

/**
 * Vercel function: /mcp (rewritten from /api/mcp). Configuration comes from
 * DOCS_DIR, DOCS_BASE_URL, DOCS_ABOUT and DOCS_NAME. The index is built once
 * per function instance and reused across requests.
 */

import { createStore, resolveConfig } from '../src/config.js';
import { createHttpHandler } from '../src/http.js';
import type { NodeHandler } from '../src/http.js';
import type { DocStore } from '../src/store.js';

export const config = { maxDuration: 60 };

export interface CreateHandlerOpts {
  store?: DocStore;
}

let cachedStore: Promise<DocStore> | null = null;

const loadCachedStore = (): Promise<DocStore> => {
  if (!cachedStore) {
    const store = createStore(resolveConfig());
    cachedStore = store.load().then(() => store);
    cachedStore.catch(() => {
      cachedStore = null;
    });
  }
  return cachedStore;
};

export const createHandler = (opts: CreateHandlerOpts = {}): NodeHandler => {
  const cfg = resolveConfig();
  return createHttpHandler({
    store: opts.store ?? loadCachedStore,
    name: cfg.name,
    ...(cfg.about !== undefined ? { about: cfg.about } : {}),
    version: process.env['npm_package_version'] ?? '0.1.0',
    info: { endpoint: '/mcp', commit_sha: process.env['VERCEL_GIT_COMMIT_SHA'] ?? null },
  });
};

export default createHandler({});
