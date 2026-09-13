// SPDX-License-Identifier: MIT

export { DocStore, normalizePath, sectionUrl, tokenize } from './store.js';
export type { DocStoreOptions, PageMetadata, SearchOptions, StoreStats } from './store.js';
export { createServer } from './server.js';
export type { CreateServerOptions } from './server.js';
export { createHttpHandler } from './http.js';
export type { HttpHandlerOptions, NodeHandler } from './http.js';
export { createDocTools, READ_ONLY, toolResult } from './tools.js';
export { auditDocs, formatAuditReport } from './audit.js';
export type { AuditIssue, AuditOptions, AuditReport, Severity } from './audit.js';
export { createStore, resolveConfig } from './config.js';
export type { DocsConfig } from './config.js';
export type { AnyToolDefinition, DocPage, DocSection, SearchHit, ToolAnnotations, ToolDefinition, ToolResult } from './types.js';
