// SPDX-License-Identifier: MIT

/**
 * Docs audit: before exposing docs to agents, check they are complete,
 * current, and structured well enough to return useful results per query.
 */

import type { DocStore } from './store.js';
import type { DocPage } from './types.js';

export type Severity = 'error' | 'warning' | 'info';

export interface AuditIssue {
  severity: Severity;
  rule: string;
  path: string;
  message: string;
}

export interface AuditOptions {
  /** Pages not touched for this many days are flagged stale. */
  staleDays?: number;
  /** Pages with fewer words are flagged thin. */
  minWords?: number;
  /** Sections with more words and no sub-headings are flagged as hard to retrieve. */
  maxSectionWords?: number;
  now?: Date;
}

export interface AuditReport {
  root: string;
  generatedAt: string;
  options: Required<Omit<AuditOptions, 'now'>>;
  summary: {
    pages: number;
    sections: number;
    words: number;
    errors: number;
    warnings: number;
    info: number;
    pagesWithIssues: number;
  };
  issues: AuditIssue[];
}

const DAY_MS = 86_400_000;
const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

const daysBetween = (a: Date, b: Date): number => Math.floor((a.getTime() - b.getTime()) / DAY_MS);

const auditPage = (
  page: DocPage,
  store: DocStore,
  opts: Required<Omit<AuditOptions, 'now'>> & { now: Date },
): AuditIssue[] => {
  const issues: AuditIssue[] = [];
  const add = (severity: Severity, rule: string, message: string): void => {
    issues.push({ severity, rule, path: page.path, message });
  };

  const fmTitle = page.frontmatter['title'];
  const h1s = page.sections.filter((s) => s.level === 1);
  if ((typeof fmTitle !== 'string' || fmTitle.trim() === '') && h1s.length === 0) {
    add('warning', 'missing-title', `No frontmatter title or H1; using "${page.title}" from the filename.`);
  }
  if (h1s.length > 1) {
    add('warning', 'multiple-h1', `${h1s.length} H1 headings; search results will carry ambiguous titles.`);
  }
  if (page.description === undefined) {
    add('info', 'missing-description', 'No frontmatter description; list_docs and resources show only the title.');
  }

  if (page.words < opts.minWords) {
    add(
      page.words === 0 ? 'error' : 'warning',
      'thin-content',
      page.words === 0 ? 'Page is empty.' : `Only ${page.words} words (threshold ${opts.minWords}).`,
    );
  }

  const age = daysBetween(opts.now, page.lastModified);
  if (age > opts.staleDays) {
    add('warning', 'stale', `Last modified ${age} days ago (threshold ${opts.staleDays}).`);
  }

  let previousLevel = 0;
  for (const section of page.sections) {
    if (section.level === 0) continue;
    if (previousLevel > 0 && section.level > previousLevel + 1) {
      add(
        'info',
        'heading-skip',
        `"${section.heading}" jumps from H${previousLevel} to H${section.level} (line ${section.startLine}).`,
      );
    }
    previousLevel = section.level;
  }

  for (let i = 0; i < page.sections.length; i += 1) {
    const section = page.sections[i];
    if (!section) continue;
    const next = page.sections[i + 1];
    const hasChildren = next !== undefined && next.level > section.level;
    const words = section.content === '' ? 0 : section.content.split(/\s+/).length;
    if (!hasChildren && words > opts.maxSectionWords) {
      add(
        'info',
        'long-section',
        `Section "${section.heading || '(preamble)'}" has ${words} words with no sub-headings; split it so search returns a focused chunk.`,
      );
    }
  }

  for (const href of page.links) {
    if (!store.resolveLink(page.path, href)) {
      add('error', 'broken-link', `Link target not found: ${href}`);
    }
  }

  return issues;
};

export const auditDocs = (store: DocStore, options: AuditOptions = {}): AuditReport => {
  const now = options.now ?? new Date();
  const opts = {
    staleDays: options.staleDays ?? 180,
    minWords: options.minWords ?? 50,
    maxSectionWords: options.maxSectionWords ?? 1500,
    now,
  };
  const pages = store.listPages();
  const issues = pages.flatMap((page) => auditPage(page, store, opts));

  const byTitle = new Map<string, string[]>();
  for (const page of pages) {
    const key = page.title.toLowerCase();
    byTitle.set(key, [...(byTitle.get(key) ?? []), page.path]);
  }
  for (const [, paths] of byTitle) {
    if (paths.length < 2) continue;
    for (const p of paths) {
      issues.push({
        severity: 'warning',
        rule: 'duplicate-title',
        path: p,
        message: `Title shared with ${paths.filter((x) => x !== p).join(', ')}; agents cannot tell them apart in results.`,
      });
    }
  }

  issues.sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.rule.localeCompare(b.rule),
  );

  const stats = store.stats();
  const count = (s: Severity): number => issues.filter((i) => i.severity === s).length;
  return {
    root: store.root,
    generatedAt: now.toISOString(),
    options: { staleDays: opts.staleDays, minWords: opts.minWords, maxSectionWords: opts.maxSectionWords },
    summary: {
      pages: stats.pages,
      sections: stats.sections,
      words: stats.words,
      errors: count('error'),
      warnings: count('warning'),
      info: count('info'),
      pagesWithIssues: new Set(issues.map((i) => i.path)).size,
    },
    issues,
  };
};

export const formatAuditReport = (report: AuditReport): string => {
  const { summary } = report;
  const lines: string[] = [
    `Docs audit: ${report.root}`,
    `${summary.pages} pages, ${summary.sections} sections, ${summary.words} words`,
    `${summary.errors} errors, ${summary.warnings} warnings, ${summary.info} info (${summary.pagesWithIssues} pages affected)`,
    '',
  ];
  if (report.issues.length === 0) {
    lines.push('No issues found.');
    return lines.join('\n');
  }
  let currentPath = '';
  for (const issue of report.issues) {
    if (issue.path !== currentPath) {
      currentPath = issue.path;
      lines.push(currentPath);
    }
    lines.push(`  ${issue.severity.padEnd(7)} ${issue.rule.padEnd(19)} ${issue.message}`);
  }
  return lines.join('\n');
};
