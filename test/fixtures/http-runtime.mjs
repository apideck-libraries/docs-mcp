// SPDX-License-Identifier: MIT

// Run unchanged both against the built library and from a clean tarball consumer.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const globals = { Request: globalThis.Request, Response: globalThis.Response, Headers: globalThis.Headers };
const { DocStore, createHttpHandler, NodeStreamableHTTPServerTransport, toolResult } = await import('@apideck/docs-mcp');
const { registerDocsTools } = await import('@apideck/docs-mcp/webmcp');
const require = createRequire(import.meta.resolve('@apideck/docs-mcp/package.json'));
const { getRequestListener } = await import(require.resolve('@hono/node-server'));
const { serveStatic } = await import(process.env.DOCS_MCP_STATIC_CONTROL ?? require.resolve('@hono/node-server/serve-static'));
const { Hono } = await import(require.resolve('hono'));

const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
const call = (id, docPath) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'get_doc', arguments: { path: docPath } } });
const decode = (text, id) => {
  const messages = text.startsWith('{') ? [JSON.parse(text)] : text.split('\n').filter((line) => line.startsWith('data: ') && line.slice(6)).map((line) => JSON.parse(line.slice(6)));
  const message = messages.find((message) => message.id === id);
  assert.ok(message, `Missing JSON-RPC response ${id}`);
  return message;
};

describe('published Node HTTP transport contract', () => {
  let root, server, origin;
  let parsed = 0, closed = 0, backpressure = 0, bridgeCalls = 0;
  let abortResolve;
  const aborted = new Promise((resolve) => { abortResolve = resolve; });
  const errors = [];
  const big = 'complete-stream-'.repeat(160_000);

  before(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'docs-mcp-http-'));
    await mkdir(path.join(root, 'admin'));
    await writeFile(path.join(root, 'guide.md'), '# Runtime guide\n\nRecover after a missing document.');
    await writeFile(path.join(root, 'hello world.txt'), 'public file');
    await writeFile(path.join(root, 'admin', 'secret.txt'), 'protected secret');
    const store = new DocStore({ root, baseUrl: 'https://example.test/docs' });
    const handler = createHttpHandler({ store, extraTools: [{
      name: 'big_output', description: 'Exercise streamed response writes.', inputSchema: {},
      handler: async () => toolResult(big),
    }] });
    const jsonHandler = createHttpHandler({ store, transportFactory: () => new NodeStreamableHTTPServerTransport({ enableJsonResponse: true }) });
    const app = new Hono();
    app.use('/static/admin/*', async (c, next) => {
      if (c.req.header('authorization') !== 'Bearer fixture') return c.text('Unauthorized', 401);
      await next();
    });
    app.use('/static/*', serveStatic({ root, rewriteRequestPath: (p) => p.replace(/^\/static/, '') }));
    const staticHandler = getRequestListener(app.fetch, { overrideGlobalObjects: false });
    server = http.createServer((req, res) => {
      void (async () => {
        const route = new URL(req.url, 'http://fixture').pathname;
        if (route.startsWith('/static/')) return staticHandler(req, res);
        if (route.startsWith('/parsed') && req.method === 'POST') {
          const chunks = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          req.body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          parsed += 1;
        }
        const bridgeRoute = route.replace(/^\/parsed/, '');
        if (bridgeRoute.startsWith('/bridge')) {
          const transport = new NodeStreamableHTTPServerTransport({
            enableJsonResponse: bridgeRoute !== '/bridge-abort', keepAliveMs: 10,
            maxRequestBodySize: 128,
            ...(bridgeRoute === '/bridge-guard' ? { enableDnsRebindingProtection: true, allowedHosts: [new URL(origin).host], allowedOrigins: ['https://allowed.test'] } : {}),
          });
          transport.setSupportedProtocolVersions(['2025-03-26']);
          transport.onerror = (error) => errors.push(error);
          transport.onclose = () => { closed += 1; };
          transport.onmessage = (message, extra) => {
            bridgeCalls += 1;
            if (bridgeRoute === '/bridge-abort') {
              extra.request.signal.addEventListener('abort', abortResolve, { once: true });
              return;
            }
            void transport.send({ jsonrpc: '2.0', id: message.id, result: {
              url: extra.request.url, client: extra.request.headers.get('x-mcp-client'),
              auth: extra.authInfo, params: message.params,
            } }, { relatedRequestId: message.id });
          };
          // Models upstream middleware's already-validated authentication info.
          req.auth = { token: 'fixture', clientId: 'fixture-client', scopes: ['docs:read'] };
          res.on('close', () => { void transport.close(); });
          await transport.start();
          return transport.handleRequest(req, res, req.body);
        }
        if (route === '/slow') {
          const write = res.write.bind(res);
          res.write = (...args) => {
            const accepted = write(...args);
            if (!accepted) backpressure += 1;
            return accepted;
          };
        }
        return (route === '/json' ? jsonHandler : handler)(req, res);
      })().catch((error) => {
        res.statusCode = 500;
        res.end(String(error));
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    server?.closeAllConnections();
    if (server) await new Promise((resolve) => server.close(resolve));
    if (root) await rm(root, { recursive: true, force: true });
  });

  const post = (route, body, extra = {}) => fetch(`${origin}${route}`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });

  it('keeps GET, OPTIONS, unsupported methods, HEAD and native globals', async () => {
    const summary = await fetch(`${origin}/mcp%20encoded?query=%2F%25`);
    assert.equal(summary.status, 200);
    assert.equal(summary.headers.get('access-control-allow-origin'), '*');
    assert.equal((await summary.json()).pages, 1);
    assert.equal((await fetch(`${origin}/mcp`, { method: 'OPTIONS' })).status, 204);
    const head = await fetch(`${origin}/mcp%20encoded`, { method: 'HEAD' });
    assert.equal(head.status, 405);
    assert.equal(await head.text(), '');
    const put = await fetch(`${origin}/mcp`, { method: 'PUT' });
    assert.equal(put.status, 405);
    assert.deepEqual(await put.json(), { error: 'Method not allowed' });
    for (const [name, value] of Object.entries(globals)) assert.equal(globalThis[name], value);
  });

  for (const route of ['/mcp%20encoded?query=%2F%25', '/parsed']) {
    it(`serves real raw JSON-RPC/SSE missing-document recovery at ${route}`, async () => {
      const before = parsed;
      const missing = await post(route, call(1, 'missing'));
      assert.equal(missing.status, 200);
      assert.match(missing.headers.get('content-type'), /text\/event-stream/);
      const negative = decode(await missing.text(), 1);
      assert.equal(negative.result.isError, true);
      assert.equal(negative.result.structuredContent.found, false);
      const recovered = await post(route, call(2, 'guide'));
      assert.equal(recovered.status, 200);
      const positive = decode(await recovered.text(), 2);
      assert.equal(positive.error, undefined);
      assert.equal(positive.result.isError, undefined);
      assert.equal(positive.result.structuredContent.path, 'guide');
      assert.equal(positive.result.structuredContent.url, 'https://example.test/docs/guide');
      assert.match(positive.result.structuredContent.content, /Recover after a missing document/);
      if (route === '/parsed') assert.equal(parsed, before + 2);
    });
  }

  it('honors a custom transportFactory with real JSON responses', async () => {
    const response = await post('/json', call(3, 'guide'));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.equal((await response.json()).result.structuredContent.path, 'guide');
  });

  it('registers WebMCP tools and executes them through the real published HTTP handler', async () => {
    const tools = new Map();
    let registrationSignal;
    const registration = await registerDocsTools({
      endpoint: `${origin}/mcp`, currentPageTool: false,
      modelContext: { registerTool: (tool, options) => { tools.set(tool.name, tool); registrationSignal = options.signal; } },
    });
    assert.ok(registration.tools.includes('get_doc'));
    assert.match(await tools.get('get_doc').execute({ path: 'missing' }), /^Error:/);
    assert.match(await tools.get('get_doc').execute({ path: 'guide' }), /Recover after a missing document/);
    registration.unregister();
    assert.equal(registrationSignal.aborted, true);
  });

  it('forwards encoded URLs, headers and upstream auth through the owned bridge', async () => {
    const response = await post('/bridge%20encoded?query=%2F%25', { jsonrpc: '2.0', id: 4, method: 'ping', params: {} }, { 'x-mcp-client': 'raw-client' });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).result, {
      url: `${origin}/bridge%20encoded?query=%2F%25`, client: 'raw-client',
      auth: { token: 'fixture', clientId: 'fixture-client', scopes: ['docs:read'] }, params: {},
    });
  });

  it('retains Host/Origin guards, supported protocol validation and error callbacks', async () => {
    const body = { jsonrpc: '2.0', id: 5, method: 'ping' };
    const before = bridgeCalls;
    const invalidHost = await new Promise((resolve, reject) => {
      const request = http.request(`${origin}/bridge-guard`, { method: 'POST', headers: { ...headers, host: 'attacker.test' } }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
      });
      request.on('error', reject);
      request.end(JSON.stringify(body));
    });
    assert.equal(invalidHost.status, 403);
    assert.match(invalidHost.body.error.message, /attacker\.test/);
    for (const extra of [{ origin: 'https://attacker.test' }]) {
      const response = await post('/bridge-guard', body, extra);
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error.code, -32000);
    }
    assert.equal(bridgeCalls, before);
    const allowed = await post('/bridge-guard', body, { origin: 'https://allowed.test' });
    assert.equal(allowed.status, 200);
    await allowed.text();
    const unsupported = await post('/bridge', body, { 'mcp-protocol-version': '2099-01-01' });
    assert.equal(unsupported.status, 400);
    assert.match((await unsupported.json()).error.message, /protocol version/i);
    const malformed = await fetch(`${origin}/bridge`, { method: 'POST', headers, body: '{', signal: AbortSignal.timeout(10_000) });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.code, -32700);
    const head = await fetch(`${origin}/bridge`, { method: 'HEAD' });
    assert.equal(head.status, 405);
    assert.equal(await head.text(), '');
    const notAcceptable = await post('/bridge', body, { accept: 'text/plain' });
    assert.equal(notAcceptable.status, 406);
    await notAcceptable.text();
    const unsupportedType = await post('/bridge', body, { 'content-type': 'text/plain' });
    assert.equal(unsupportedType.status, 415);
    await unsupportedType.text();
    assert.ok(errors.length >= 3);
  });

  it('preserves declared and chunked raw-body limits without dispatching oversized messages', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'ping', params: { note: 'x'.repeat(256) } });
    const before = bridgeCalls;
    const response = await fetch(`${origin}/bridge`, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 413);
    await response.text();
    const chunked = await new Promise((resolve, reject) => {
      const request = http.request(`${origin}/bridge`, { method: 'POST', headers }, (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject);
      request.write(body.slice(0, 100));
      request.end(body.slice(100));
    });
    assert.equal(chunked, 413);
    assert.equal(bridgeCalls, before);
  });

  it('uses a consumed parsed body without applying the raw-reader limit a second time', async () => {
    const body = { jsonrpc: '2.0', id: 9, method: 'ping', params: { note: 'x'.repeat(256) } };
    const before = parsed;
    const response = await post('/parsed/bridge', body);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).result.params, body.params);
    assert.equal(parsed, before + 1);
  });

  it('delivers complete SSE output while the client pauses and writes encounter backpressure', { timeout: 15_000 }, async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'big_output', arguments: {} } });
    const text = await new Promise((resolve, reject) => {
      const request = http.request(`${origin}/slow`, { method: 'POST', headers }, (response) => {
        assert.equal(response.statusCode, 200);
        response.pause();
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        setTimeout(() => response.resume(), 30);
      });
      request.on('error', reject);
      request.end(body);
    });
    assert.equal(decode(text, 7).result.content[0].text, big);
    assert.ok(backpressure > 0);
  });

  it('aborts the Web request and closes the bridge when an SSE client disconnects', { timeout: 5_000 }, async () => {
    const before = closed;
    await new Promise((resolve, reject) => {
      const request = http.request(`${origin}/bridge-abort`, { method: 'POST', headers }, (response) => {
        response.once('data', () => { response.destroy(); resolve(); });
      });
      request.on('error', reject);
      request.end(JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'ping' }));
    });
    await aborted;
    // The abort and close callbacks run in the same socket-close event.
    assert.ok(closed > before);
  });

  it('blocks controlled double-decoding auth bypass and preserves valid protected/public requests', async () => {
    // serveStatic is not used by docs-mcp. This control targets its declared
    // adapter's advisory while the other tests exercise the library itself.
    for (const route of ['/static/admin/secret.txt', '/static/%61dmin/secret.txt']) {
      const response = await fetch(`${origin}${route}`);
      assert.equal(response.status, 401);
      assert.equal(await response.text(), 'Unauthorized');
    }
    const attack = await fetch(`${origin}/static/%%36%31dmin/secret.txt`);
    const attackBody = await attack.text();
    assert.equal(attack.status, 404, `Double-decoding control returned: ${attackBody}`);
    assert.doesNotMatch(attackBody, /protected secret/);
    const authorized = await fetch(`${origin}/static/admin/secret.txt`, { headers: { authorization: 'Bearer fixture' } });
    assert.equal(authorized.status, 200);
    assert.equal(await authorized.text(), 'protected secret');
    const publicFile = await fetch(`${origin}/static/hello%20world.txt`);
    assert.equal(publicFile.status, 200);
    assert.equal(await publicFile.text(), 'public file');
    for (const route of ['/static/%2e%2e%2fadmin/secret.txt', '/static/%5cadmin/secret.txt', '/static//admin/secret.txt']) {
      const response = await fetch(`${origin}${route}`);
      assert.equal(response.status, 404);
      await response.text();
    }
    for (const [name, value] of Object.entries(globals)) assert.equal(globalThis[name], value);
  });
});
