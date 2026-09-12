// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { auditDocs, formatAuditReport } from './audit.js';
import { DocStore } from './store.js';

describe('auditDocs', () => {
  let dir: string;
  let store: DocStore;

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'docs-audit-'));
    await mkdir(path.join(dir, 'guides'));
    await writeFile(
      path.join(dir, 'good.md'),
      `---\ntitle: Good page\ndescription: Fine.\nupdated: 2026-09-01\n---\n# Good page\n\n${'word '.repeat(60)}\n\n## Sub\n\nSee [the guide](guides/old.md).\n`,
    );
    await writeFile(
      path.join(dir, 'guides', 'old.md'),
      `---\nupdated: 2020-01-01\n---\n# Old\n\nintro\n\n### Skipped level\n\n${'text '.repeat(80)}\n\nmore [missing](nowhere.md)\n\n# Second H1\n`,
    );
    await writeFile(path.join(dir, 'empty.md'), '');
    await writeFile(path.join(dir, 'dupe.md'), `---\ntitle: Good page\n---\n\n${'filler '.repeat(70)}\n`);
    store = new DocStore({ root: dir });
    await store.load();
  });
  after(() => rm(dir, { recursive: true, force: true }));

  it('flags the expected rules per page', () => {
    const report = auditDocs(store, { now: new Date('2026-09-12') });
    const rules = (p: string) => report.issues.filter((i) => i.path === p).map((i) => i.rule).sort();

    assert.deepEqual(rules('good'), ['duplicate-title']);
    assert.deepEqual(rules('guides/old'), ['broken-link', 'heading-skip', 'missing-description', 'multiple-h1', 'stale']);
    assert.deepEqual(rules('empty'), ['missing-description', 'missing-title', 'thin-content']);
    assert.deepEqual(rules('dupe'), ['duplicate-title', 'missing-description']);

    assert.equal(report.summary.pages, 4);
    assert.equal(report.summary.errors, 2);
    assert.equal(report.issues.find((i) => i.path === 'empty' && i.rule === 'thin-content')?.severity, 'error');
  });

  it('respects thresholds', () => {
    const relaxed = auditDocs(store, { now: new Date('2026-09-12'), staleDays: 10_000, minWords: 0 });
    assert.ok(!relaxed.issues.some((i) => i.rule === 'stale'));
    assert.ok(!relaxed.issues.some((i) => i.rule === 'thin-content'));
  });

  it('flags long sections without sub-headings', () => {
    const report = auditDocs(store, { now: new Date('2026-09-12'), maxSectionWords: 50 });
    assert.ok(report.issues.some((i) => i.rule === 'long-section' && i.path === 'guides/old'));
  });

  it('formats a grouped text report', () => {
    const text = formatAuditReport(auditDocs(store, { now: new Date('2026-09-12') }));
    assert.match(text, /^Docs audit: /);
    assert.match(text, /4 pages/);
    assert.match(text, /\nguides\/old\n\s+error\s+broken-link/);
  });
});

describe('auditDocs on the bundled docs', () => {
  it('reports no errors', async () => {
    const store = new DocStore({ root: path.resolve('docs') });
    await store.load();
    const report = auditDocs(store);
    assert.equal(report.summary.errors, 0, formatAuditReport(report));
  });
});
