# Node HTTP transport and release candidate

The prepared **0.4.1** release removes the runtime dependency on
`@modelcontextprotocol/node` 2.1.0. Its current published successor, 2.1.1,
still requires `@hono/node-server ^1.19.9`, which resolves to affected 1.19.17,
and additionally requires a newer MCP server. Instead, docs-mcp declares
`@hono/node-server` **2.1.3** and its required `hono` **4.13.13** peer directly.
The supported MCP server remains **2.2.0**.

This addresses [GHSA-rmxm-3fg6-px4f](https://github.com/honojs/node-server/security/advisories/GHSA-rmxm-3fg6-px4f).
The advisory concerns double decoding in `serveStatic`, allowing prefix
middleware to be bypassed for files within its configured root. docs-mcp does
not serve static files through that middleware, but it must not install the
affected adapter into its consumers. A package-manager override in this
repository would not provide that guarantee after publication.

## Runtime and compatibility

`src/node-http.ts` is a small, library-owned Node bridge. It follows the public
delegation contract of the SDK Node transport: `getRequestListener` converts
Node requests/responses and the supported
`WebStandardStreamableHTTPServerTransport` implements MCP. This is a new
composition over public dependency APIs; no SDK protocol implementation or
static-file implementation is vendored. Protocol validation, sessions, raw-body
limits, errors and SSE remain SDK-owned. Request conversion, abort signals,
streamed writes and backpressure remain Hono-owned. Upstream references:
[SDK Node bridge](https://github.com/modelcontextprotocol/typescript-sdk/tree/main/packages/middleware/node)
and [Hono v2 release](https://github.com/honojs/node-server/releases/tag/v2.0.0).

The bridge passes `overrideGlobalObjects: false` and forwards upstream `req.auth`
and pre-parsed bodies. It preserves the SDK's default **4 MiB** raw-body limit;
when the host has already parsed `req.body`, the host remains responsible for
its parsing limit. Existing `createHttpHandler`, `createServer`, tools, stdio,
WebMCP and CLI interfaces are unchanged. Node **20+** was already required;
Hono v2's removed `/vercel` entry point is not used.

Custom `transportFactory` uses the structural `NodeHttpTransport` interface.
Existing SDK Node transport instances remain assignable when callers explicitly
declare that SDK package themselves. Such callers own its dependency graph;
using an old external transport can reintroduce an affected adapter. The
library's exported transport provides the patched default and customization:

```ts
import { createHttpHandler, DocStore, NodeStreamableHTTPServerTransport } from '@apideck/docs-mcp';

const handler = createHttpHandler({
  store: new DocStore({ root: './docs' }),
  transportFactory: () => new NodeStreamableHTTPServerTransport({ enableJsonResponse: true }),
});
```

## Verification and publication

Run the pinned **pnpm 9.15.4** workflow:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:package
```

`pnpm test:package` builds through `prepack`, creates a tarball and installs it
into a clean npm consumer without overrides, resolutions or package extensions.
It checks the complete installed graph, exercises raw JSON-RPC/SSE, consumed
Next-style bodies, missing-document recovery, WebMCP, encoded URLs, HEAD,
native globals, guards, limits, streaming/backpressure, disconnect cleanup and
the controlled static-prefix negative/positive security fixture. It also runs
the installed CLI over actual stdio. A separate type-only consumer checks the
old SDK Node factory's assignability; its explicitly installed SDK is excluded
from the clean runtime graph proof. Pass an external directory as the script's
argument to retain the tarball, manifests, graphs and logs.

There is no automated publish workflow or Changesets configuration in this
repository. Previous releases use an explicit package-version preparation PR
and human publication. **0.4.1** is a patch to source 0.4.0 and includes its
previously unreleased WebMCP/instruction additions; the last published version
was 0.3.0 when this candidate was prepared. No package is published by this PR.

After independent review, final-head CI assessment and human merge, the release
owner must check out the exact approved merge commit, rerun the verification
above, inspect `pnpm pack` contents and the clean-consumer graph, and confirm
that npm does not already contain 0.4.1. Publish the reviewed tarball as 0.4.1
with public access using the organization's approved credentials/provenance
process. The release owner should verify npm's version and integrity against
the uploaded artifact. Publication is a separate approved action; no publishing
credentials are needed to build or verify this candidate.

Only after the approved package is available on npm should downstream sites
adopt it, regenerate their own locks, verify their installed runtime and deployed
MCP endpoint, and remove any scoped Hono workaround that has become unnecessary.
