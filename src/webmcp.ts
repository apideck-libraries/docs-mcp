// SPDX-License-Identifier: MIT

/**
 * WebMCP bridge: registers the docs server's tools with the browser
 * (`document.modelContext`) so an agent on a docs page can search and read
 * the docs through structured tool calls instead of scraping the page.
 *
 * Runs in the browser and has no Node dependencies. Tool names, schemas and
 * annotations come from the server's `tools/list` at page load, so
 * `extraTools` a host registers on the server show up here too. Every call is
 * forwarded to the server's Streamable HTTP endpoint with `X-MCP-Client:
 * webmcp`, which `onToolCall` reports as the caller.
 *
 * WebMCP is experimental (Chrome 149+, behind a flag or origin trial). Where
 * `document.modelContext` is missing, registration is a no-op.
 */

/** The subset of the WebMCP tool definition this bridge uses. */
export interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (inputs: Record<string, unknown>, ctx?: { signal?: AbortSignal }) => Promise<string>;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean; consequentialHint?: boolean };
}

export interface ModelContext {
  registerTool: (tool: WebMcpTool, opts?: { signal?: AbortSignal }) => Promise<void> | void;
}

export interface RegisterDocsToolsOptions {
  /** URL of the docs MCP endpoint, e.g. "/mcp" on the same origin. */
  endpoint: string;
  /** Extra request headers, e.g. a token for a gated endpoint. */
  headers?: Record<string, string>;
  /**
   * Also register `read_current_page`, which returns the page the agent is
   * on via get_doc with `location.href`. Needs pages to have public URLs
   * (`--base-url` or the `metadata` hook). Default true.
   */
  currentPageTool?: boolean;
  /** Only register these server tools (by name). Default: all of them. */
  tools?: string[];
  /** Overrides for tests or non-standard hosts. */
  modelContext?: ModelContext;
  fetch?: typeof fetch;
  location?: { href: string };
}

export interface RegisteredDocsTools {
  /** Names of the tools registered with the browser; empty when WebMCP is unavailable. */
  tools: string[];
  /** Unregisters every tool. */
  unregister: () => void;
}

interface ListedTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
}

interface CallResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

const CURRENT_PAGE_TOOL = 'read_current_page';

const findModelContext = (): ModelContext | undefined =>
  (globalThis as { document?: { modelContext?: ModelContext } }).document?.modelContext;

/** Parses a JSON or SSE-framed JSON-RPC response and returns the message with the given id. */
interface RpcMessage {
  id?: number;
  result?: unknown;
  error?: { message: string };
}

const parseRpc = async (res: Response, id: number): Promise<RpcMessage> => {
  const body = await res.text();
  if (!(res.headers.get('content-type') ?? '').includes('text/event-stream')) return JSON.parse(body);
  for (const line of body.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const msg = JSON.parse(line.slice(5).trim()) as RpcMessage;
    if (msg.id === id) return msg;
  }
  throw new Error('No JSON-RPC response in event stream');
};

export const registerDocsTools = async (opts: RegisterDocsToolsOptions): Promise<RegisteredDocsTools> => {
  const modelContext = opts.modelContext ?? findModelContext();
  if (!modelContext) return { tools: [], unregister: () => undefined };

  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  let nextId = 1;

  const rpc = async (method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> => {
    const id = nextId++;
    const res = await doFetch(opts.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'X-MCP-Client': 'webmcp',
        ...opts.headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      ...(signal !== undefined ? { signal } : {}),
    });
    if (!res.ok) throw new Error(`${method} failed: HTTP ${res.status}`);
    const msg = await parseRpc(res, id);
    if (msg.error) throw new Error(`${method} failed: ${msg.error.message}`);
    return msg.result;
  };

  const callTool = async (name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> => {
    const result = (await rpc('tools/call', { name, arguments: args }, signal)) as CallResult;
    const text = (result.content ?? [])
      .filter((c) => c.type === 'text' && c.text !== undefined)
      .map((c) => c.text)
      .join('\n\n');
    // Error results are returned as text too: they carry suggestions the agent can act on.
    return result.isError ? `Error: ${text}` : text;
  };

  const { tools: listed } = (await rpc('tools/list', {})) as { tools: ListedTool[] };
  const wanted = opts.tools !== undefined ? new Set(opts.tools) : undefined;

  const defs: WebMcpTool[] = listed
    .filter((t) => wanted === undefined || wanted.has(t.name))
    .map((t) => ({
      name: t.name,
      description: t.description ?? t.name,
      inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
      annotations: { readOnlyHint: t.annotations?.readOnlyHint === true },
      execute: (inputs, ctx) => callTool(t.name, inputs, ctx?.signal),
    }));

  if (opts.currentPageTool !== false && listed.some((t) => t.name === 'get_doc')) {
    const location = opts.location ?? (globalThis as { location?: { href: string } }).location;
    if (location !== undefined) {
      defs.push({
        name: CURRENT_PAGE_TOOL,
        description:
          'Return the documentation page the user is viewing as clean markdown, with a section outline. Pass `section` (an anchor or heading) to get one section; by default the section in the URL fragment is returned, if any.',
        inputSchema: {
          type: 'object',
          properties: { section: { type: 'string', description: 'Anchor or heading text of one section.' } },
        },
        annotations: { readOnlyHint: true },
        execute: (inputs, ctx) =>
          callTool(
            'get_doc',
            { path: location.href, ...(typeof inputs['section'] === 'string' ? { section: inputs['section'] } : {}) },
            ctx?.signal,
          ),
      });
    }
  }

  const controller = new AbortController();
  for (const def of defs) await modelContext.registerTool(def, { signal: controller.signal });
  return { tools: defs.map((d) => d.name), unregister: () => controller.abort() };
};
