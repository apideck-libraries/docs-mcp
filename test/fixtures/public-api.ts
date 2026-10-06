import type { IncomingMessage, ServerResponse } from 'node:http';

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

// Consume the declared factory result, not just assign a compatible factory.
function consumeFactoryTransport(options: HttpHandlerOptions, req: IncomingMessage, res: ServerResponse): void {
  const transport = options.transportFactory?.();
  if (!transport) return;
  const state: Required<Pick<typeof transport, 'sessionId' | 'onclose' | 'onerror' | 'onmessage'>> = transport;
  const sessionId: string | undefined = state.sessionId;
  transport.onclose = () => { void sessionId; };
  transport.onerror = (error) => { void error.message; };
  transport.onmessage = (message, extra) => { void [message.jsonrpc, extra?.authInfo]; };
  transport.onclose = undefined;
  transport.onerror = undefined;
  transport.onmessage = undefined;
  void transport.start();
  void transport.send({ jsonrpc: '2.0', id: 1, result: {} }, { relatedRequestId: 1 });
  transport.setSupportedProtocolVersions(['2025-03-26']);
  transport.setScopeChallengeResolver(() => undefined);
  transport.closeSSEStream(1);
  transport.closeStandaloneSSEStream();
  void transport.handleRequest(req, res, { jsonrpc: '2.0', id: 1, method: 'ping' });
  void transport.close();
  void sessionId;
}
void consumeFactoryTransport;
