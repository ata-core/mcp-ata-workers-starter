<p align="center">
  <a href="https://hono.dev"><img src="https://raw.githubusercontent.com/honojs/hono/main/docs/images/hono-title.png" alt="Hono" width="300" /></a>
</p>

# mcp-ata-workers-starter

An MCP server on Cloudflare Workers, built on Hono and the official TypeScript SDK, where each tool's `inputSchema` is one JSON Schema file that does two jobs: it is what the model sees in `tools/list`, and it is what checks the arguments the model sends back. The schemas are compiled ahead of time with [ata-validator](https://github.com/ata-core/ata-validator), so the deployed Worker carries no validator engine, and nothing of the validation calls `new Function`, which Workers refuse.

When the model gets an argument wrong, the tool result says which field, what the schema expected and what arrived, so the model can correct the call instead of giving up:

```text
Invalid arguments for send_receipt: /order_id: must match pattern "^ord_[a-z0-9]{8,}$", found "nope"; /email: must match format "email", found "x"
```

```text
schemas/tools.json            one JSON Schema per tool
   │
   ├─ compileTools ──► src/generated/*.validator.mjs   validates, imports nothing
   │                └► src/generated/index.mjs         what the provider takes
   │
   └─ imported as JSON ──────────────────────────────► tools/list
```

## Run it

```sh
npm install
npm run dev        # compiles the tool schemas, then wrangler dev
npm test           # compiles, then the four tests below
npm run measure    # the numbers in the next section, on this machine
npm run deploy     # compiles, then wrangler deploy
```

The server is at `/mcp` over Streamable HTTP. Point an MCP client at it, or try it by hand:

```sh
curl -s -D - -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -X POST localhost:8787/mcp \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

Take the `mcp-session-id` header from the answer and send it with the calls that follow.

Change a schema in `schemas/tools.json`, run `npm run tools`, and the validator and the listing follow. The provider looks validators up by a hash of the schema, so a schema edited without a rebuild misses rather than validating against the old one.

## What is in it

`src/index.ts` is the whole server:

- `AtaAotJsonSchemaValidator` from `@ata-project/mcp/aot` wraps the compiled modules. That entry imports neither ata-validator nor a Node builtin, which is what keeps the engine out of the bundle.
- The `tools/list` handler returns the schemas as they are in the JSON file. The `tools/call` handler validates the arguments with the compiled validator and returns the message above as a tool error when they fail.
- The same provider is given to the SDK's `Server` as `jsonSchemaValidator`, the slot the SDK otherwise fills with its default validator, which cannot compile on Workers.
- `@hono/mcp` carries the Streamable HTTP transport on a Hono route.

## What it costs

Measured on this template with `npm run measure` (Apple M4 Pro, Node 25, esbuild for the bundle), against the same server with the validation removed, and against the same server taking the provider from the package's main entry instead of `/aot`:

| | this template | same server, no validation | provider from the main entry |
|---|---|---|---|
| worker bundle, minified | 328.7 KB | 313.3 KB | 780.8 KB |
| worker bundle, gzipped | 96.6 KB | 92.7 KB | 224.9 KB |
| fresh process to the first tool result | 92.7 ms | 91.4 ms | |

Validating the two tools costs 3.9 KB gzipped, and between 1 and 4 ms at start over three runs of the script. The rest of both columns is the SDK and Hono; the SDK alone is most of it. The third column is why the `/aot` entry exists: the main entry holds the runtime provider too, and a bundler brings the whole engine along with it.

Through `wrangler dev`, which runs the `workerd` Cloudflare runs in production, a validated `tools/call` answers in 1.34 ms at the median over 200 requests (p90 1.76 ms), on the same machine.

## Tests

`test/mcp.test.ts` holds four things: the server initializes and lists the tools with their schema as written, a valid call runs, an invalid one gets the message with every failing field named, and the bundle carries the compiled tools and the `/aot` entry but no validator engine, with nothing of ata's calling `new Function`.

## License

MIT
