// SPDX-License-Identifier: MIT

import type { z } from 'zod';

/** One heading-delimited chunk of a page. Level 0 is the text before the first heading. */
export interface DocSection {
  /** Unique across the index: `<path>` for the preamble, `<path>#<anchor>` otherwise. */
  id: string;
  path: string;
  title: string;
  heading: string;
  /** Heading text of every ancestor, ending with this section's own heading. */
  headingPath: string[];
  anchor: string;
  level: number;
  content: string;
  startLine: number;
}

export interface DocPage {
  /** Root-relative path without extension, e.g. `guides/getting-started`. */
  path: string;
  file: string;
  title: string;
  description?: string;
  frontmatter: Record<string, unknown>;
  body: string;
  lastModified: Date;
  words: number;
  sections: DocSection[];
  /** Relative links found in the body (external, mailto and pure-anchor links excluded). */
  links: string[];
  url?: string;
}

export interface SearchHit {
  path: string;
  title: string;
  heading: string;
  anchor: string;
  score: number;
  snippet: string;
  url?: string;
}

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface ToolDefinition<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  inputSchema: Shape;
  annotations: ToolAnnotations;
  handler: (args: z.infer<z.ZodObject<Shape>>) => Promise<ToolResult>;
}

/** Shape-erased tool definition, for registries that hold tools with different input schemas. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDefinition = ToolDefinition<any>;
