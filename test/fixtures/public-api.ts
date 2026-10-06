import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport, DocStore, createServer, createHttpHandler, createDocTools, toolResult, READ_ONLY, auditDocs, formatAuditReport, resolveConfig, createStore, normalizePath, sectionUrl, tokenize } from '@apideck/docs-mcp';
import type { AnyToolDefinition, ToolDefinition, ToolResult, ToolAnnotations, DocStoreOptions, PageMetadata, SearchOptions, StoreStats, DocPage, DocSection, SearchHit, CreateServerOptions, HttpHandlerOptions, NodeHandler, AuditIssue, AuditOptions, AuditReport, Severity, DocsConfig } from '@apideck/docs-mcp';
const metadata: PageMetadata = { title: 'Title', url: 'https://example.test/ref#op' };
const options: DocStoreOptions = { root: '../fixtures/docs', metadata: () => metadata };
const store = new DocStore(options);
const schema = { value: z.string(), limit: z.number().default(2) };
const annotations: ToolAnnotations = READ_ONLY;
const custom: ToolDefinition<typeof schema> = {
  name: 'typed_tool', title: 'Typed', description: 'A typed consumer tool', inputSchema: schema, annotations,
  handler: async ({ value, limit }): Promise<ToolResult> => toolResult(value.repeat(limit), { value, limit }),
};
const extraTools: AnyToolDefinition[] = [custom];
const serverOptions: CreateServerOptions = { store, extraTools };
const server: McpServer = createServer(serverOptions);
const httpOptions: HttpHandlerOptions = { store: async () => store, extraTools: async () => extraTools, transportFactory: () => new NodeStreamableHTTPServerTransport({}) };
const handler: NodeHandler = createHttpHandler(httpOptions);
const searchOptions: SearchOptions = { limit: 2, pathPrefix: '', perPage: 1 };
const hits: SearchHit[] = store.search('value', searchOptions);
const pages: DocPage[] = store.listPages();
const sections: DocSection[] = pages.flatMap(p => p.sections);
const stats: StoreStats = store.stats();
const auditOptions: AuditOptions = { minWords: 0 };
const report: AuditReport = auditDocs(store, auditOptions);
const issues: AuditIssue[] = report.issues;
const severity: Severity = 'warning';
const config: DocsConfig = resolveConfig();
void [server, handler, hits, sections, stats, issues, severity, createStore(config), createDocTools(store), formatAuditReport(report), normalizePath('a.md'), sectionUrl({url:'https://example.test'},'x'), tokenize('a')];
