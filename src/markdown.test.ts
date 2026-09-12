// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  countWords,
  deriveTitle,
  extractLinks,
  frontmatterDate,
  makeSnippet,
  parseFrontmatter,
  slugify,
  splitSections,
  toPlainText,
} from './markdown.js';

describe('parseFrontmatter', () => {
  it('parses YAML frontmatter and strips it from the body', () => {
    const { data, body, hasFrontmatter } = parseFrontmatter('---\ntitle: Hello\ntags: [a, b]\n---\n\n# Hi\n');
    assert.equal(hasFrontmatter, true);
    assert.equal(data['title'], 'Hello');
    assert.deepEqual(data['tags'], ['a', 'b']);
    assert.equal(body, '\n# Hi\n');
  });

  it('returns the raw text when there is no frontmatter', () => {
    const { data, body, hasFrontmatter } = parseFrontmatter('# Hi\n');
    assert.equal(hasFrontmatter, false);
    assert.deepEqual(data, {});
    assert.equal(body, '# Hi\n');
  });

  it('survives malformed YAML', () => {
    const { data, hasFrontmatter } = parseFrontmatter('---\ntitle: [unclosed\n---\nbody');
    assert.equal(hasFrontmatter, true);
    assert.deepEqual(data, {});
  });
});

describe('slugify', () => {
  it('produces GitHub-style anchors', () => {
    assert.equal(slugify('Getting Started!'), 'getting-started');
    assert.equal(slugify('The `search_docs` tool'), 'the-search_docs-tool');
    assert.equal(slugify('  Multiple   spaces  '), 'multiple-spaces');
  });
});

describe('splitSections', () => {
  it('splits on headings and tracks the heading path', () => {
    const md = 'intro\n\n# Title\n\npara\n\n## Install\n\nsteps\n\n### Mac\n\nbrew\n\n## Use\n\ngo\n';
    const sections = splitSections(md);
    assert.deepEqual(
      sections.map((s) => [s.level, s.heading, s.anchor]),
      [
        [0, '', ''],
        [1, 'Title', 'title'],
        [2, 'Install', 'install'],
        [3, 'Mac', 'mac'],
        [2, 'Use', 'use'],
      ],
    );
    assert.deepEqual(sections[3]?.headingPath, ['Title', 'Install', 'Mac']);
    assert.deepEqual(sections[4]?.headingPath, ['Title', 'Use']);
    assert.equal(sections[0]?.content, 'intro');
    assert.equal(sections[2]?.content, 'steps');
  });

  it('ignores headings inside fenced code blocks', () => {
    const md = '# Real\n\n```md\n# Not a heading\n```\n\n~~~\n## Also not\n~~~\n\n## Real too\n';
    const sections = splitSections(md);
    assert.deepEqual(
      sections.map((s) => s.heading),
      ['Real', 'Real too'],
    );
    assert.match(sections[0]?.content ?? '', /# Not a heading/);
  });

  it('de-duplicates repeated anchors', () => {
    const sections = splitSections('# A\n\n## Notes\n\nx\n\n## Notes\n\ny\n');
    assert.deepEqual(
      sections.map((s) => s.anchor),
      ['a', 'notes', 'notes-1'],
    );
  });

  it('omits an empty preamble', () => {
    assert.equal(splitSections('\n\n# Only\n\ntext')[0]?.level, 1);
  });
});

describe('extractLinks', () => {
  it('keeps relative links and drops external, anchor, mailto and image links', () => {
    const md = [
      '[a](guides/a.md) [b](../b.md#x "title") [c](https://x.com) [d](#local)',
      '[e](mailto:x@y.z) ![img](pic.png) [f](<spaced path.md>)',
      '```\n[ignored](in-code.md)\n```',
    ].join('\n');
    assert.deepEqual(extractLinks(md), ['guides/a.md', '../b.md#x', 'spaced path.md']);
  });
});

describe('toPlainText / countWords', () => {
  it('strips markdown syntax', () => {
    const plain = toPlainText('# Head\n\n- **bold** and `code` and [link](x.md)\n\n```js\nignored()\n```\n');
    assert.equal(plain, 'Head bold and code and link');
    assert.equal(countWords('# Head\n\none two three'), 4);
    assert.equal(countWords(''), 0);
  });
});

describe('deriveTitle', () => {
  it('prefers frontmatter, then H1, then the filename', () => {
    const h1 = splitSections('# From H1\n');
    assert.equal(deriveTitle({ title: 'FM' }, h1, 'x/y'), 'FM');
    assert.equal(deriveTitle({}, h1, 'x/y'), 'From H1');
    assert.equal(deriveTitle({}, [], 'guides/getting-started'), 'Getting Started');
  });
});

describe('frontmatterDate', () => {
  it('reads the first recognised date key', () => {
    assert.equal(frontmatterDate({ updated: '2026-01-02' })?.toISOString().slice(0, 10), '2026-01-02');
    assert.equal(frontmatterDate({ date: new Date('2025-05-05') })?.getUTCFullYear(), 2025);
    assert.equal(frontmatterDate({ updated: 'not a date' }), null);
    assert.equal(frontmatterDate({}), null);
  });
});

describe('makeSnippet', () => {
  it('centres on the first matching term and marks truncation', () => {
    const text = `${'a '.repeat(200)}needle here ${'b '.repeat(200)}`.trim();
    const snippet = makeSnippet(text, ['needle'], 60);
    assert.match(snippet, /needle/);
    assert.ok(snippet.startsWith('…') && snippet.endsWith('…'));
    assert.ok(snippet.length <= 64);
  });

  it('returns short text untouched', () => {
    assert.equal(makeSnippet('short', ['x']), 'short');
  });
});
