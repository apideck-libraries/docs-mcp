// SPDX-License-Identifier: MIT

import yaml from 'js-yaml';

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  body: string;
  hasFrontmatter: boolean;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export const parseFrontmatter = (raw: string): ParsedFrontmatter => {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return { data: {}, body: raw, hasFrontmatter: false };
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = yaml.load(match[1] ?? '');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed YAML: keep the page, drop the metadata.
  }
  return { data, body: raw.slice(match[0].length), hasFrontmatter: true };
};

/** GitHub-style heading anchors. */
export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .trim()
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');

export interface RawSection {
  heading: string;
  level: number;
  anchor: string;
  headingPath: string[];
  content: string;
  startLine: number;
}

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING_RE = /^\s{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;

/**
 * Split a markdown body on ATX headings. Headings inside fenced code blocks are
 * ignored. The preamble (text before the first heading) becomes a level-0
 * section when non-empty.
 */
export const splitSections = (body: string): RawSection[] => {
  const lines = body.split(/\r?\n/);
  const sections: RawSection[] = [];
  const stack: Array<{ level: number; text: string }> = [];
  const anchorCounts = new Map<string, number>();

  let current: RawSection = {
    heading: '',
    level: 0,
    anchor: '',
    headingPath: [],
    content: '',
    startLine: 1,
  };
  let buffer: string[] = [];
  let fenceChar: string | null = null;
  let fenceLen = 0;

  const flush = (): void => {
    current.content = buffer.join('\n').trim();
    if (current.content !== '' || current.level > 0) sections.push(current);
    buffer = [];
  };

  lines.forEach((line, i) => {
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1] ?? '';
      const char = marker[0] ?? '`';
      if (fenceChar === null) {
        fenceChar = char;
        fenceLen = marker.length;
      } else if (char === fenceChar && marker.length >= fenceLen) {
        fenceChar = null;
        fenceLen = 0;
      }
      buffer.push(line);
      return;
    }

    const heading = fenceChar === null ? HEADING_RE.exec(line) : null;
    if (!heading) {
      buffer.push(line);
      return;
    }

    flush();
    const level = (heading[1] ?? '#').length;
    const text = (heading[2] ?? '').trim();
    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) {
      stack.pop();
    }
    stack.push({ level, text });

    let anchor = slugify(text);
    if (anchor === '') anchor = `section-${sections.length + 1}`;
    const seen = anchorCounts.get(anchor) ?? 0;
    anchorCounts.set(anchor, seen + 1);
    if (seen > 0) anchor = `${anchor}-${seen}`;

    current = {
      heading: text,
      level,
      anchor,
      headingPath: stack.map((s) => s.text),
      content: '',
      startLine: i + 1,
    };
  });
  flush();
  return sections;
};

const stripFences = (md: string): string => md.replace(/(`{3,}|~{3,})[\s\S]*?\1/g, ' ');

const LINK_RE = /!?\[[^\]]*\]\(\s*(?:<([^>]*)>|([^)\s]+))(?:\s+["'][^"']*["'])?\s*\)/g;
const EXTERNAL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/** Relative link targets in the body. Images, external, mailto and pure-anchor links are skipped. */
export const extractLinks = (body: string): string[] => {
  const out: string[] = [];
  const text = stripFences(body);
  for (const match of text.matchAll(LINK_RE)) {
    if (match[0].startsWith('!')) continue;
    const href = match[1] ?? match[2] ?? '';
    if (href === '' || EXTERNAL_RE.test(href)) continue;
    out.push(href);
  }
  return out;
};

/** Reduce markdown to readable plain text, for snippets and word counts. */
export const toPlainText = (md: string): string =>
  stripFences(md)
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^\s*[-*+][ \t]+/gm, '')
    .replace(/^\s*\d+\.[ \t]+/gm, '')
    .replace(/^\s*>[ \t]?/gm, '')
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, ' ')
    .replace(/\|/g, ' ')
    .replace(/(\*\*|__|~~|\*)/g, '')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const countWords = (md: string): number => {
  const text = toPlainText(md);
  return text === '' ? 0 : text.split(/\s+/).length;
};

export const titleFromPath = (path: string): string => {
  const last = path.split('/').filter(Boolean).pop() ?? path;
  return last
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
};

/** Frontmatter `title`, else the first H1, else a title derived from the filename. */
export const deriveTitle = (
  frontmatter: Record<string, unknown>,
  sections: RawSection[],
  path: string,
): string => {
  const fm = frontmatter['title'];
  if (typeof fm === 'string' && fm.trim() !== '') return fm.trim();
  const h1 = sections.find((s) => s.level === 1);
  if (h1) return h1.heading;
  return titleFromPath(path);
};

const DATE_KEYS = ['updated', 'last_updated', 'lastUpdated', 'lastmod', 'date'] as const;

/** A parseable date from frontmatter, if present. */
export const frontmatterDate = (frontmatter: Record<string, unknown>): Date | null => {
  for (const key of DATE_KEYS) {
    const value = frontmatter[key];
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'string' || typeof value === 'number') {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
};

/** Short excerpt around the first query term hit, or the start of the text. */
export const makeSnippet = (plain: string, terms: string[], width = 240): string => {
  if (plain.length <= width) return plain;
  const lower = plain.toLowerCase();
  let hit = -1;
  for (const term of terms) {
    const t = term.toLowerCase();
    if (t === '') continue;
    const idx = lower.indexOf(t);
    if (idx !== -1 && (hit === -1 || idx < hit)) hit = idx;
  }
  if (hit === -1) return `${plain.slice(0, width).trimEnd()}…`;
  const half = Math.floor(width / 2);
  let start = Math.max(0, hit - half);
  let end = Math.min(plain.length, start + width);
  if (end - start < width) start = Math.max(0, end - width);
  // Snap to word boundaries.
  if (start > 0) {
    const sp = plain.indexOf(' ', start);
    if (sp !== -1 && sp < hit) start = sp + 1;
  }
  if (end < plain.length) {
    const sp = plain.lastIndexOf(' ', end);
    if (sp > hit) end = sp;
  }
  return `${start > 0 ? '…' : ''}${plain.slice(start, end).trim()}${end < plain.length ? '…' : ''}`;
};
