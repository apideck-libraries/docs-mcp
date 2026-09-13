// SPDX-License-Identifier: MIT

import { z } from 'zod';

import { sectionUrl } from './store.js';
import type { DocStore } from './store.js';
import type { AnyToolDefinition, DocPage, ToolDefinition, ToolResult } from './types.js';

export const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;

/** Build a tool result: text for the model plus optional structured content, for reuse by host-defined tools. */
export const toolResult = (body: string, structured?: Record<string, unknown>, isError = false): ToolResult => ({
  content: [{ type: 'text', text: body }],
  ...(structured !== undefined ? { structuredContent: structured } : {}),
  ...(isError ? { isError: true } : {}),
});

const text = toolResult;

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

const pageHeader = (page: DocPage): string => {
  const lines = [`# ${page.title}`, '', `path: ${page.path}`];
  if (page.url !== undefined) lines.push(`url: ${page.url}`);
  if (page.description !== undefined) lines.push(`description: ${page.description}`);
  lines.push(`last_modified: ${isoDate(page.lastModified)}`, `words: ${page.words}`);
  return lines.join('\n');
};

const outlineSections = (page: DocPage): DocPage['sections'] => {
  const headed = page.sections.filter((s) => s.level > 0);
  const h1s = headed.filter((s) => s.level === 1);
  // A single H1 that is the page title adds nothing to the outline.
  return h1s.length === 1 && h1s[0]?.heading === page.title ? headed.filter((s) => s.level !== 1) : headed;
};

const sectionOutline = (page: DocPage): string => {
  const sections = outlineSections(page);
  const minLevel = Math.min(...sections.map((s) => s.level));
  return sections.map((s) => `${'  '.repeat(s.level - minLevel)}- ${s.heading} (#${s.anchor})`).join('\n');
};

const searchSchema = {
  query: z.string().min(1).describe('Free-text query. Prefix matching and light fuzzy matching are applied per term.'),
  limit: z.number().int().min(1).max(25).default(8).describe('Maximum number of results.'),
  path_prefix: z
    .string()
    .optional()
    .describe('Only search pages whose path starts with this prefix, e.g. "guides" or "api/reference".'),
};

const getSchema = {
  path: z
    .string()
    .min(1)
    .describe(
      'Page path from search_docs or list_docs, e.g. "guides/getting-started" (extensions and "docs://" prefix are accepted), or a full https:// URL to the page, optionally with a #fragment.',
    ),
  section: z
    .string()
    .optional()
    .describe(
      'Return only this section: an anchor ("#install" or "install") or the heading text. Defaults to the #fragment of `path` when `path` is a URL.',
    ),
};

const listSchema = {
  path_prefix: z.string().optional().describe('Only list pages under this path prefix.'),
  limit: z.number().int().min(1).max(1000).default(200).describe('Maximum number of pages to list.'),
};

export const createDocTools = (store: DocStore): AnyToolDefinition[] => {
  const searchDocs: ToolDefinition<typeof searchSchema> = {
    name: 'search_docs',
    title: 'Search documentation',
    description:
      'Full-text search over the documentation. Returns matching sections with a snippet, the page path and heading anchor. Call get_doc with a returned path to read the full page or a single section.',
    inputSchema: searchSchema,
    annotations: READ_ONLY,
    handler: async ({ query, limit, path_prefix }) => {
      const hits = store.search(query, {
        limit,
        ...(path_prefix !== undefined ? { pathPrefix: path_prefix } : {}),
      });
      const stats = store.stats();
      if (hits.length === 0) {
        return text(
          `No results for "${query}" across ${stats.pages} pages. Try fewer or broader terms, or list_docs to browse.`,
          { query, results: [] },
        );
      }
      const lines = [`${hits.length} result(s) for "${query}" (${stats.pages} pages indexed):`, ''];
      hits.forEach((h, i) => {
        const where = h.heading ? `${h.title} › ${h.heading}` : h.title;
        const ref = h.anchor ? `${h.path}#${h.anchor}` : h.path;
        lines.push(`${i + 1}. ${where}`, `   path: ${ref}`);
        if (h.url !== undefined) lines.push(`   url: ${h.url}`);
        if (h.snippet) lines.push(`   ${h.snippet}`);
        lines.push('');
      });
      return text(lines.join('\n').trimEnd(), { query, results: hits });
    },
  };

  const getDoc: ToolDefinition<typeof getSchema> = {
    name: 'get_doc',
    title: 'Get documentation page',
    description:
      'Return the full markdown of a documentation page by path, or a single section of it. Use search_docs or list_docs to find paths.',
    inputSchema: getSchema,
    annotations: READ_ONLY,
    handler: async ({ path, section }) => {
      const isUrl = /^https?:\/\//i.test(path);
      const resolved = isUrl ? store.getByUrl(path) : undefined;
      const page = resolved?.page ?? (isUrl ? undefined : store.get(path));
      if (!page) {
        const suggestions = isUrl
          ? []
          : store.search(path.replace(/[/#._-]+/g, ' '), { limit: 5, perPage: 1 });
        const hint =
          suggestions.length > 0
            ? `\n\nDid you mean:\n${suggestions.map((s) => `- ${s.path} (${s.title})`).join('\n')}`
            : '';
        return text(`No page at "${path}".${hint}`, { path, found: false }, true);
      }
      // An explicit `section` argument must resolve or the call errors. A
      // section implied only by the URL's #fragment is best-effort: some
      // fragments are page-relative UI state rather than a heading (or the
      // page's own URL already carries a fragment, e.g. a Redoc deep link),
      // so a miss there falls through to the whole page instead of erroring.
      const explicitSection = section?.trim();
      const effectiveSection = explicitSection || resolved?.anchor;

      if (effectiveSection !== undefined && effectiveSection !== '') {
        const wanted = effectiveSection.replace(/^#/, '').toLowerCase();
        const match = page.sections.find(
          (s) => s.level > 0 && (s.anchor.toLowerCase() === wanted || s.heading.toLowerCase() === wanted),
        );
        if (!match && explicitSection) {
          return text(
            `No section "${explicitSection}" in ${page.path}. Available sections:\n${sectionOutline(page) || '(none)'}`,
            { path: page.path, found: false },
            true,
          );
        }
        if (match) {
          // Include nested sub-sections so the caller gets the whole subtree.
          const start = page.sections.indexOf(match);
          const subtree = [match];
          for (let i = start + 1; i < page.sections.length; i += 1) {
            const s = page.sections[i];
            if (!s || s.level <= match.level) break;
            subtree.push(s);
          }
          const body = subtree
            .map((s) => `${'#'.repeat(s.level)} ${s.heading}\n\n${s.content}`.trimEnd())
            .join('\n\n');
          return text(`${pageHeader(page)}\nsection: #${match.anchor}\n\n---\n\n${body}`, {
            path: page.path,
            title: page.title,
            section: match.anchor,
            ...(page.url !== undefined ? { url: sectionUrl(page, match.anchor) } : {}),
            content: body,
          });
        }
      }

      const outline = sectionOutline(page);
      return text(
        `${pageHeader(page)}${outline ? `\n\nsections:\n${outline}` : ''}\n\n---\n\n${page.body.trim()}`,
        {
          path: page.path,
          title: page.title,
          ...(page.url !== undefined ? { url: page.url } : {}),
          last_modified: page.lastModified.toISOString(),
          sections: outlineSections(page).map((s) => ({ heading: s.heading, anchor: s.anchor, level: s.level })),
          content: page.body.trim(),
        },
      );
    },
  };

  const listDocs: ToolDefinition<typeof listSchema> = {
    name: 'list_docs',
    title: 'List documentation pages',
    description:
      'List documentation pages with their path, title, description and last-modified date. Useful to browse the structure before searching or to find pages under a prefix.',
    inputSchema: listSchema,
    annotations: READ_ONLY,
    handler: async ({ path_prefix, limit }) => {
      const all = store.listPages(path_prefix);
      const pages = all.slice(0, limit);
      const stats = store.stats();
      const header =
        path_prefix !== undefined
          ? `${all.length} page(s) under "${path_prefix}"${all.length > limit ? `, showing ${limit}` : ''}:`
          : `${all.length} page(s)${all.length > limit ? `, showing ${limit}` : ''}:`;
      const lines = pages.map((p) => {
        const desc = p.description !== undefined ? ` — ${p.description}` : '';
        return `- ${p.path}: ${p.title}${desc} (${p.words} words, updated ${isoDate(p.lastModified)})`;
      });
      return text([header, ...lines].join('\n'), {
        total: all.length,
        indexed_at: stats.indexedAt?.toISOString() ?? null,
        pages: pages.map((p) => ({
          path: p.path,
          title: p.title,
          ...(p.description !== undefined ? { description: p.description } : {}),
          ...(p.url !== undefined ? { url: p.url } : {}),
          words: p.words,
          last_modified: p.lastModified.toISOString(),
        })),
      });
    },
  };

  return [searchDocs, getDoc, listDocs];
};
