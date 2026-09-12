---
title: Auditing your docs
description: Check that documentation is complete, current and structured to return useful results before exposing it to agents.
updated: 2026-09-12
---

# Auditing your docs

An MCP server is only as useful as the docs behind it. Before wiring it up, run the audit and fix what it reports.

```bash
docs-mcp audit --docs ./docs
```

The command exits with status 1 when it finds errors, so it fits in CI next to a link checker.

## What it checks

| Rule | Severity | Meaning |
| --- | --- | --- |
| `broken-link` | error | A relative link points at a page that does not exist. |
| `thin-content` | error or warning | The page is empty, or shorter than `--min-words` (default 50). |
| `stale` | warning | The page has not changed in more than `--stale-days` (default 180). Uses frontmatter `updated`, `last_updated`, `lastmod` or `date` when present, otherwise the file's modification time. |
| `missing-title` | warning | No frontmatter title and no H1; the title is derived from the filename. |
| `multiple-h1` | warning | More than one H1, so results carry ambiguous titles. |
| `duplicate-title` | warning | Two pages share a title; agents cannot tell them apart in results. |
| `missing-description` | info | No frontmatter description, so listings show only the title. |
| `heading-skip` | info | A heading jumps more than one level, for example H1 straight to H3. |
| `long-section` | info | A section has more than `--max-section-words` (default 1500) words and no sub-headings, so search returns an unfocused chunk. |

Add `--json` for a machine-readable report.

## Writing docs that search well

Each heading becomes a separately indexed, separately retrievable chunk. A few habits make a large difference:

- Give every page a frontmatter `title` and a one-sentence `description`. Both are boosted in ranking and shown in listings.
- Use one H1 per page and nest H2 and H3 under it without skipping levels.
- Keep sections focused. If a section runs past a screen or two, split it with a sub-heading.
- Put the terms people search for in headings, not only in prose. "Rate limits" as a heading beats a paragraph that mentions them.
- Record an `updated` date in frontmatter when the content is reviewed, so freshness does not depend on file timestamps.
- Link between pages with relative links; the audit verifies them and the `get_doc` tool follows the same path rules.

## Deciding between a skill file and an MCP server

Use a skill file when the workflow is stable and you want something machine-readable quickly. Use an MCP server when the documentation changes frequently and agents need to search and retrieve current content at query time. Whichever you pick, audit the source first: incomplete or stale docs return confidently wrong answers either way.
