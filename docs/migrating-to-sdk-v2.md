# SDK v2 migration

The next release moves from `@modelcontextprotocol/sdk` to the maintained split
packages: `@modelcontextprotocol/server` 2.2.0 and `@modelcontextprotocol/node`
2.1.0. Tests use `@modelcontextprotocol/client` 2.2.0. The package no longer
installs SDK v1, Express, body-parser or standalone raw-body, including through
its development dependencies. Existing Zod and other unrelated resolutions stay
unchanged.

## Library callers

`DocStore`, `createHttpHandler`, the three documentation tools, resources,
`extraTools` and `toolResult` retain their application interfaces and results.
Host metadata, canonical URLs and pre-parsed Node `req.body` continue to work.
The default server keeps the ordinary initialization handshake used by existing
2025 clients; this migration does not opt into the 2026 protocol.

Callers using SDK classes directly need to update imports and types:

```ts
import type { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { createServer, createHttpHandler, DocStore } from '@apideck/docs-mcp';

const store = new DocStore({ root: './docs' });
const server: McpServer = createServer({ store });
const handler = createHttpHandler({
  store,
  transportFactory: () => new NodeStreamableHTTPServerTransport({}),
});
```

`createServer` now returns the v2 `McpServer`. Its public members differ from SDK
v1; old `tool`, `resource`, `prompt` helpers and experimental APIs are not a
compatibility surface. Use the v2 registration APIs. `transportFactory` now
returns `NodeStreamableHTTPServerTransport`. V1 class annotations/factories are
not assignable to these types. No v1 dependency or compatibility shim is retained.
Custom tools still take a raw Zod shape; docs-mcp wraps it as a Zod object when
registering it. Validation, defaults and input transforms run before the handler.

## Observable SDK differences

- Standalone HTTP requests read by the SDK now have its default **4 MiB** body
  limit, returning HTTP 413 above it. A host-supplied `req.body` bypasses that
  reader, so the host is responsible for its own parsing limit. Next Pages API's
  default 1 MiB parsing limit remains independent and unchanged.
- Stdio has a **10 MiB** input-buffer limit, already present in the resolved v1
  baseline. V2 closes on stdin EOF; clients must keep stdin open until outstanding
  responses are read.
- Invalid tool arguments still produce a tool result with `isError: true`, but
  SDK error wording can change. Unknown tools produce a JSON-RPC invalid-params
  error (`-32602`); clients should handle rejected calls as well as tool errors.
- Tool schemas declare JSON Schema 2020-12, and tool listings no longer include
  the SDK v1 `execution.taskSupport: forbidden` field. Application input constraints
  and successful documentation result shapes remain the same.

These changes warrant a pre-1.0 minor release; **0.3.0 is proposed**, not published
by this change. Both merging and package publication require human approval.
See the [official SDK migration guide](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2.html)
for SDK-level API details.

## Adoption in a documentation site

A parent-package change does not update an already installed site. After the
approved parent release, update the site's dependency and lockfile, verify the
installed graph and actual route/metadata behavior, and run its deployment checks.
For developer-docs, the original raw-body finding concerns its standalone
`raw-body@3.0.2` lockfile entry through SDK v1 (directly and through Express /
body-parser). Next's separate compiled body parser remains; removing this package
chain is not an application-wide removal of every bundled parser. Scanner
confirmation belongs after the application's approved adoption and rollout.
