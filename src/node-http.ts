// SPDX-License-Identifier: MIT

import type { IncomingMessage, ServerResponse } from 'node:http';

import { getRequestListener } from '@hono/node-server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import type { AuthInfo, Transport, WebStandardStreamableHTTPServerTransportOptions } from '@modelcontextprotocol/server';

/** Structural contract: existing SDK Node transport factories remain compatible. */
export interface NodeHttpTransport extends Transport {
  handleRequest(req: IncomingMessage & { auth?: AuthInfo }, res: ServerResponse, parsedBody?: unknown): Promise<void>;
}

export type NodeStreamableHTTPServerTransportOptions = WebStandardStreamableHTTPServerTransportOptions;

/**
 * Library-owned Node bridge to the supported SDK Web Standard transport.
 * Protocol, limits, sessions and SSE remain SDK-owned; Node conversion and
 * streamed writes remain owned by the explicitly declared patched Hono adapter.
 * Mirrors the SDK Node bridge's delegation contract without importing its
 * vulnerable transitive adapter. See docs/http-transport-security.md.
 */
export class NodeStreamableHTTPServerTransport implements NodeHttpTransport {
  private readonly web: WebStandardStreamableHTTPServerTransport;

  constructor(options: NodeStreamableHTTPServerTransportOptions = {}) {
    this.web = new WebStandardStreamableHTTPServerTransport(options);
  }

  get sessionId(): string | undefined { return this.web.sessionId; }

  get onclose(): Transport['onclose'] { return this.web.onclose; }
  set onclose(callback: Transport['onclose']) {
    if (callback === undefined) delete this.web.onclose;
    else this.web.onclose = callback;
  }

  get onerror(): Transport['onerror'] { return this.web.onerror; }
  set onerror(callback: Transport['onerror']) {
    if (callback === undefined) delete this.web.onerror;
    else this.web.onerror = callback;
  }

  get onmessage(): Transport['onmessage'] { return this.web.onmessage; }
  set onmessage(callback: Transport['onmessage']) {
    if (callback === undefined) delete this.web.onmessage;
    else this.web.onmessage = callback;
  }

  start(): Promise<void> { return this.web.start(); }
  close(): Promise<void> { return this.web.close(); }

  send(...args: Parameters<WebStandardStreamableHTTPServerTransport['send']>): Promise<void> {
    return this.web.send(...args);
  }

  setSupportedProtocolVersions(versions: string[]): void {
    this.web.setSupportedProtocolVersions(versions);
  }

  setScopeChallengeResolver(...args: Parameters<WebStandardStreamableHTTPServerTransport['setScopeChallengeResolver']>): void {
    this.web.setScopeChallengeResolver(...args);
  }

  closeSSEStream(...args: Parameters<WebStandardStreamableHTTPServerTransport['closeSSEStream']>): void {
    this.web.closeSSEStream(...args);
  }

  closeStandaloneSSEStream(): void { this.web.closeStandaloneSSEStream(); }

  async handleRequest(req: IncomingMessage & { auth?: AuthInfo }, res: ServerResponse, parsedBody?: unknown): Promise<void> {
    const authInfo = req.auth;
    await getRequestListener((request) => this.web.handleRequest(request, {
      ...(authInfo !== undefined ? { authInfo } : {}),
      ...(parsedBody !== undefined ? { parsedBody } : {}),
    }), { overrideGlobalObjects: false })(req, res);
  }
}
