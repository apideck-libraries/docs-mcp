// SPDX-License-Identifier: MIT

import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import MiniSearch from 'minisearch';
import type { SearchResult } from 'minisearch';

import {
  countWords,
  deriveTitle,
  extractLinks,
  frontmatterDate,
  makeSnippet,
  parseFrontmatter,
  splitSections,
  toPlainText,
} from './markdown.js';
import type { DocPage, DocSection, SearchHit } from './types.js';

/** Per-page overrides supplied by the host, e.g. from a build manifest. */
export interface PageMetadata {
  title?: string;
  description?: string;
  url?: string;
}

export interface DocStoreOptions {
  /** Directory holding the markdown docs. */
  root: string;
  /** Resolve extra metadata for a page path (root-relative, no extension). Wins over frontmatter and `baseUrl`. */
  metadata?: (docPath: string) => PageMetadata | undefined;
  /** Public site root used to build `url` fields, e.g. `https://docs.example.com`. */
  baseUrl?: string;
  extensions?: string[];
  /** Directory names to skip while walking. */
  ignore?: string[];
}

export interface SearchOptions {
  limit?: number;
  pathPrefix?: string;
  /** Max hits from the same page (default 3), so one long page does not crowd out the rest. */
  perPage?: number;
}

export interface StoreStats {
  root: string;
  pages: number;
  sections: number;
  words: number;
  indexedAt: Date | null;
}

/**
 * Tokenizer that keeps identifiers such as `search_docs`, `rate-limit` or
 * `foo.bar` as one token and also emits their parts, so an exact identifier
 * query outranks pages that merely contain the words.
 */
export const tokenize = (text: string): string[] => {
  const out: string[] = [];
  for (const raw of text.split(/[^\p{L}\p{N}_.-]+/u)) {
    const token = raw.replace(/^[._-]+|[._-]+$/g, '');
    if (token === '') continue;
    out.push(token);
    if (/[._-]/.test(token)) {
      for (const part of token.split(/[._-]+/)) if (part !== '') out.push(part);
    }
  }
  return out;
};

const DEFAULT_EXTENSIONS = ['.md', '.mdx', '.markdown'];
const DEFAULT_IGNORE = ['node_modules', '.git', '.next', 'dist', '.vercel'];
const INDEX_NAMES = ['index', 'README', 'readme'];

/** Turn any user-supplied reference into the canonical page path. */
export const normalizePath = (ref: string): string =>
  ref
    .trim()
    .replace(/\\/g, '/')
    .replace(/^docs:\/\//, '')
    .replace(/[#?].*$/, '')
    .replace(/^(\.\/|\/)+/, '')
    .replace(/\.(mdx?|markdown)$/i, '')
    .replace(/\/+$/, '');

/** URL for a section: page URL plus anchor, unless the page URL already carries a fragment (e.g. a Redoc deep link). */
export const sectionUrl = (page: Pick<DocPage, 'url'>, anchor: string): string | undefined => {
  if (page.url === undefined) return undefined;
  if (anchor === '' || page.url.includes('#')) return page.url;
  return `${page.url}#${anchor}`;
};

const stripSuffix = (s: string, suffixes: string[]): string => {
  for (const suffix of suffixes) {
    if (s.toLowerCase().endsWith(suffix.toLowerCase())) return s.slice(0, -suffix.length);
  }
  return s;
};

export class DocStore {
  readonly root: string;
  readonly baseUrl: string | undefined;
  private readonly metadata: ((docPath: string) => PageMetadata | undefined) | undefined;
  private readonly extensions: string[];
  private readonly ignore: Set<string>;
  private pagesByPath = new Map<string, DocPage>();
  private pagesByUrl = new Map<string, DocPage>();
  private index: MiniSearch<DocSection> | null = null;
  private indexedAt: Date | null = null;
  private loading: Promise<void> | null = null;

  constructor(opts: DocStoreOptions) {
    this.root = path.resolve(opts.root);
    this.baseUrl = opts.baseUrl?.replace(/\/+$/, '');
    this.metadata = opts.metadata;
    this.extensions = (opts.extensions ?? DEFAULT_EXTENSIONS).map((e) =>
      e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`,
    );
    this.ignore = new Set(opts.ignore ?? DEFAULT_IGNORE);
  }

  /** Read every page under `root` and rebuild the search index. Safe to call repeatedly. */
  async load(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = this.rebuild().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async rebuild(): Promise<void> {
    const info = await stat(this.root).catch(() => null);
    if (!info?.isDirectory()) {
      throw new Error(`Docs directory not found: ${this.root}`);
    }
    const files = await this.walk(this.root);
    const pages = await Promise.all(files.map((file) => this.readPage(file)));
    pages.sort((a, b) => a.path.localeCompare(b.path));

    const index = new MiniSearch<DocSection>({
      idField: 'id',
      fields: ['title', 'heading', 'content', 'path'],
      storeFields: ['path', 'title', 'heading', 'anchor', 'content'],
      tokenize,
      searchOptions: {
        boost: { title: 3, heading: 2, path: 1.5 },
        prefix: true,
        fuzzy: 0.2,
      },
    });
    index.addAll(pages.flatMap((p) => p.sections));

    this.pagesByPath = new Map(pages.map((p) => [p.path, p]));
    this.pagesByUrl = new Map(pages.filter((p) => p.url !== undefined).map((p) => [p.url as string, p]));
    this.index = index;
    this.indexedAt = new Date();
  }

  private async walk(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const out: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.') || this.ignore.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...(await this.walk(full)));
      } else if (entry.isFile() && this.extensions.includes(path.extname(entry.name).toLowerCase())) {
        out.push(full);
      }
    }
    return out;
  }

  private async readPage(file: string): Promise<DocPage> {
    const [raw, info] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
    const rel = path.relative(this.root, file).split(path.sep).join('/');
    const docPath = normalizePath(rel);
    const { data, body } = parseFrontmatter(raw);
    const rawSections = splitSections(body);
    const meta = this.metadata?.(docPath) ?? {};
    const title = meta.title ?? deriveTitle(data, rawSections, docPath);
    const description =
      meta.description ?? (typeof data['description'] === 'string' ? data['description'] : undefined);
    const url = meta.url ?? this.urlFor(docPath, data);

    const sections: DocSection[] = rawSections.map((s) => ({
      id: s.level === 0 ? docPath : `${docPath}#${s.anchor}`,
      path: docPath,
      title,
      heading: s.heading,
      headingPath: s.headingPath,
      anchor: s.anchor,
      level: s.level,
      content: s.content,
      startLine: s.startLine,
    }));

    return {
      path: docPath,
      file,
      title,
      ...(description !== undefined ? { description } : {}),
      frontmatter: data,
      body,
      lastModified: frontmatterDate(data) ?? info.mtime,
      words: countWords(body),
      sections,
      links: extractLinks(body),
      ...(url !== undefined ? { url } : {}),
    };
  }

  private urlFor(docPath: string, frontmatter: Record<string, unknown>): string | undefined {
    const explicit = frontmatter['url'];
    if (typeof explicit === 'string' && explicit !== '') return explicit;
    if (this.baseUrl === undefined) return undefined;
    const clean = stripSuffix(docPath, INDEX_NAMES.map((n) => `/${n}`));
    const publicPath = INDEX_NAMES.includes(clean) ? '' : clean;
    return `${this.baseUrl}/${publicPath}`.replace(/\/+$/, '') || this.baseUrl;
  }

  private ensureLoaded(): void {
    if (!this.index) throw new Error('DocStore not loaded; call load() first');
  }

  stats(): StoreStats {
    const pages = [...this.pagesByPath.values()];
    return {
      root: this.root,
      pages: pages.length,
      sections: pages.reduce((n, p) => n + p.sections.length, 0),
      words: pages.reduce((n, p) => n + p.words, 0),
      indexedAt: this.indexedAt,
    };
  }

  listPages(pathPrefix?: string): DocPage[] {
    this.ensureLoaded();
    const prefix = pathPrefix === undefined ? '' : normalizePath(pathPrefix);
    return [...this.pagesByPath.values()].filter(
      (p) => prefix === '' || p.path === prefix || p.path.startsWith(`${prefix}/`),
    );
  }

  /** Resolve a page by path, tolerating extensions, leading `./`, `docs://`, anchors and folder-index shorthand. */
  get(ref: string): DocPage | undefined {
    this.ensureLoaded();
    const p = normalizePath(ref);
    const candidates = p === '' ? INDEX_NAMES : [p, ...INDEX_NAMES.map((n) => `${p}/${n}`)];
    for (const c of candidates) {
      const hit = this.pagesByPath.get(c);
      if (hit) return hit;
    }
    const lower = p.toLowerCase();
    for (const [key, page] of this.pagesByPath) {
      if (key.toLowerCase() === lower) return page;
    }
    return undefined;
  }

  /**
   * Resolve a page by its public URL (as configured via `baseUrl` or the
   * `metadata` hook), tolerating a trailing slash and a `#fragment`. Returns
   * the page plus the fragment as a candidate section anchor, when the URL's
   * own fragment isn't already baked into the page's stored URL (e.g. a
   * Redoc deep link) — matching that case would strip a fragment the page
   * actually needs.
   */
  getByUrl(url: string): { page: DocPage; anchor?: string } | undefined {
    this.ensureLoaded();
    const trimmed = url.trim().replace(/\/(?=(?:#|$))/, '');
    const direct = this.pagesByUrl.get(trimmed);
    if (direct) return { page: direct };
    const hashIndex = trimmed.indexOf('#');
    if (hashIndex === -1) return undefined;
    const withoutFragment = trimmed.slice(0, hashIndex);
    const page = this.pagesByUrl.get(withoutFragment);
    if (!page) return undefined;
    const anchor = trimmed.slice(hashIndex + 1);
    return anchor === '' ? { page } : { page, anchor };
  }

  /** Resolve a relative link from `fromPath` to a page in the store. */
  resolveLink(fromPath: string, href: string): DocPage | undefined {
    const target = href.replace(/[#?].*$/, '');
    if (target === '') return this.get(fromPath);
    const fromDir = path.posix.dirname(fromPath);
    const joined = target.startsWith('/')
      ? target
      : path.posix.normalize(path.posix.join(fromDir === '.' ? '' : fromDir, target));
    if (joined.startsWith('..')) return undefined;
    return this.get(joined);
  }

  search(query: string, opts: SearchOptions = {}): SearchHit[] {
    this.ensureLoaded();
    const index = this.index as MiniSearch<DocSection>;
    const limit = opts.limit ?? 8;
    const perPage = opts.perPage ?? 3;
    const prefix = opts.pathPrefix === undefined ? '' : normalizePath(opts.pathPrefix);
    const filter =
      prefix === ''
        ? undefined
        : (r: SearchResult) => r['path'] === prefix || String(r['path']).startsWith(`${prefix}/`);

    const run = (combineWith: 'AND' | 'OR') =>
      index.search(query, { combineWith, ...(filter ? { filter } : {}) });
    let results = run('AND');
    if (results.length === 0) results = run('OR');

    const terms = query.split(/\s+/).filter(Boolean);
    const counts = new Map<string, number>();
    const hits: SearchHit[] = [];
    for (const r of results) {
      const docPath = r['path'] as string;
      const seen = counts.get(docPath) ?? 0;
      if (seen >= perPage) continue;
      counts.set(docPath, seen + 1);
      const page = this.pagesByPath.get(docPath);
      const anchor = r['anchor'] as string;
      const url = page ? sectionUrl(page, anchor) : undefined;
      hits.push({
        path: docPath,
        title: r['title'] as string,
        heading: r['heading'] as string,
        anchor,
        score: Math.round(r.score * 100) / 100,
        snippet: makeSnippet(toPlainText(r['content'] as string), terms),
        ...(url !== undefined ? { url } : {}),
      });
      if (hits.length >= limit) break;
    }
    return hits;
  }

  /**
   * Rebuild the index whenever a file under `root` changes. Returns a function
   * that stops watching. Recursive watching needs Node 20+ on Linux; on older
   * setups this logs a warning and returns a no-op.
   */
  watch(onReload?: (err: Error | null) => void, debounceMs = 300): () => void {
    let watcher: FSWatcher;
    try {
      watcher = watch(this.root, { recursive: true }, () => schedule());
    } catch (err) {
      console.error(`docs-mcp: file watching unavailable (${String(err)}); index is static`);
      return () => undefined;
    }
    let timer: NodeJS.Timeout | null = null;
    const schedule = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        this.load().then(
          () => onReload?.(null),
          (err: unknown) => onReload?.(err instanceof Error ? err : new Error(String(err))),
        );
      }, debounceMs);
    };
    watcher.on('error', (err) => onReload?.(err));
    return () => {
      if (timer) clearTimeout(timer);
      watcher.close();
    };
  }
}
