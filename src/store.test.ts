// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { DocStore, normalizePath, sectionUrl, tokenize } from './store.js';

const DOCS = path.resolve('docs');

describe('normalizePath', () => {
  it('canonicalises references', () => {
    assert.equal(normalizePath('./guides/a.md'), 'guides/a');
    assert.equal(normalizePath('/guides/a.mdx#anchor'), 'guides/a');
    assert.equal(normalizePath('docs://guides/a/'), 'guides/a');
    assert.equal(normalizePath('guides\\a.markdown'), 'guides/a');
  });
});

describe('DocStore over the bundled docs', () => {
  const store = new DocStore({ root: DOCS, baseUrl: 'https://example.com/' });
  before(() => store.load());

  it('indexes every page with sections and metadata', () => {
    const stats = store.stats();
    assert.ok(stats.pages >= 5, `expected >=5 pages, got ${stats.pages}`);
    assert.ok(stats.sections > stats.pages);
    assert.ok(stats.indexedAt instanceof Date);
    const page = store.get('tools');
    assert.ok(page);
    assert.equal(page.title, 'Tools');
    assert.equal(page.url, 'https://example.com/tools');
    assert.ok(page.description?.length);
    assert.ok(page.sections.some((s) => s.anchor === 'search_docs'));
  });

  it('resolves index shorthand and case-insensitive paths', () => {
    assert.equal(store.get('')?.path, 'index');
    assert.equal(store.get('index.md')?.path, 'index');
    assert.equal(store.get('TOOLS')?.path, 'tools');
    assert.equal(store.get('nope'), undefined);
    assert.equal(store.get('index')?.url, 'https://example.com');
  });

  it('resolves relative links between pages', () => {
    assert.equal(store.resolveLink('index', 'tools.md')?.path, 'tools');
    assert.equal(store.resolveLink('index', 'auditing.md#writing-docs-that-search-well')?.path, 'auditing');
    assert.equal(store.resolveLink('index', '../outside.md'), undefined);
  });

  it('searches with heading boosts and page dedup', () => {
    const hits = store.search('search_docs', { limit: 5 });
    assert.ok(hits.length > 0);
    assert.equal(hits[0]?.path, 'tools');
    assert.equal(hits[0]?.anchor, 'search_docs');
    assert.equal(hits[0]?.url, 'https://example.com/tools#search_docs');
    assert.ok(hits[0]?.snippet.length);
    const perPage = new Map<string, number>();
    for (const h of hits) perPage.set(h.path, (perPage.get(h.path) ?? 0) + 1);
    for (const n of perPage.values()) assert.ok(n <= 3);
  });

  it('falls back to OR matching when not every term matches', () => {
    const hits = store.search('vercel zzzqqq');
    assert.ok(hits.some((h) => h.path === 'hosting'));
  });

  it('filters by path prefix and returns nothing for gibberish', () => {
    assert.ok(store.search('audit', { pathPrefix: 'hosting' }).every((h) => h.path === 'hosting'));
    assert.deepEqual(store.search('zzzqqqxxx'), []);
  });

  it('lists pages sorted by path, optionally under a prefix', () => {
    const paths = store.listPages().map((p) => p.path);
    assert.deepEqual(paths, [...paths].sort((a, b) => a.localeCompare(b)));
    assert.deepEqual(
      store.listPages('tools').map((p) => p.path),
      ['tools'],
    );
  });
});

describe('DocStore reload and watch', () => {
  let dir: string;
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'docs-mcp-'));
    await writeFile(path.join(dir, 'a.md'), '---\ntitle: Alpha\n---\n# Alpha\n\nfirst version of alpha\n');
  });
  after(() => rm(dir, { recursive: true, force: true }));

  it('reflects new files after load() is called again', async () => {
    const store = new DocStore({ root: dir });
    await store.load();
    assert.equal(store.stats().pages, 1);
    await writeFile(path.join(dir, 'b.md'), '# Beta\n\nbeta page about pelicans\n');
    await store.load();
    assert.equal(store.stats().pages, 2);
    assert.equal(store.search('pelicans')[0]?.path, 'b');
  });

  it('rebuilds automatically while watching', async () => {
    const store = new DocStore({ root: dir });
    await store.load();
    const reloaded = new Promise<void>((resolve, reject) => {
      const stop = store.watch((err) => {
        stop();
        if (err) reject(err);
        else resolve();
      }, 50);
    });
    await writeFile(path.join(dir, 'c.md'), '# Gamma\n\ngamma page about flamingos\n');
    await reloaded;
    assert.equal(store.search('flamingos')[0]?.path, 'c');
  });

  it('throws a clear error for a missing directory', async () => {
    await assert.rejects(new DocStore({ root: path.join(dir, 'missing') }).load(), /Docs directory not found/);
  });
});

describe('tokenize', () => {
  it('keeps identifiers whole and also emits their parts', () => {
    assert.deepEqual(tokenize('Call search_docs, then rate-limit (v2.1).'), [
      'Call',
      'search_docs',
      'search',
      'docs',
      'then',
      'rate-limit',
      'rate',
      'limit',
      'v2.1',
      'v2',
      '1',
    ]);
  });
});

describe('DocStore metadata hook', () => {
  it('lets the host override title, description and url per page', async () => {
    const store = new DocStore({
      root: DOCS,
      baseUrl: 'https://example.com',
      metadata: (p) =>
        p === 'tools' ? { title: 'Tool reference', description: 'From manifest', url: 'https://example.com/ref#tools' } : undefined,
    });
    await store.load();
    const page = store.get('tools');
    assert.equal(page?.title, 'Tool reference');
    assert.equal(page?.description, 'From manifest');
    assert.equal(page?.url, 'https://example.com/ref#tools');
    // A page URL that already has a fragment is not given a second one.
    assert.equal(store.search('search_docs')[0]?.url, 'https://example.com/ref#tools');
    assert.equal(sectionUrl({ url: 'https://example.com/a' }, 'x'), 'https://example.com/a#x');
    assert.equal(sectionUrl({ url: 'https://example.com/a' }, ''), 'https://example.com/a');
    assert.equal(sectionUrl({}, 'x'), undefined);
    assert.equal(store.get('hosting')?.url, 'https://example.com/hosting');
    assert.equal(store.search('search_docs')[0]?.title, 'Tool reference');
  });
});
