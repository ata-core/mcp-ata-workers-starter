import { Hono } from 'hono'
import { StreamableHTTPTransport } from '@hono/mcp'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { AtaAotJsonSchemaValidator } from '@ata-project/mcp/aot'
import tools from '../schemas/tools.json' with { type: 'json' }
import compiled from './generated/index.mjs'

// One JSON Schema per tool, in schemas/tools.json. `ata build` style
// compilation (scripts/compile-tools.ts) turned each into a module that
// imports nothing, so the Worker carries no validator engine and never
// calls `new Function`, which Workers refuse. The same JSON is what the
// client sees in tools/list.
const validator = new AtaAotJsonSchemaValidator(compiled, { allErrors: true, detailed: true })
const validators = Object.fromEntries(Object.entries(tools).map(([name, schema]) => [name, validator.getValidator<Record<string, unknown>>(schema)]))

const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  search_orders: (a) => ({ customer_id: a.customer_id, orders: [{ id: 'ord_7f3k2m9x1q', status: a.status ?? 'open' }].slice(0, Number(a.limit ?? 10)) }),
  send_receipt: (a) => ({ sent: true, order_id: a.order_id, to: a.email }),
}

export function buildServer () {
  // The SDK's default validator for elicitation is ajv, which it would
  // construct here; ours serves that slot too, so nothing in the Worker
  // compiles a schema at run time.
  const server = new Server({ name: 'mcp-ata-workers-starter', version: '0.1.0' }, { capabilities: { tools: {} }, jsonSchemaValidator: validator })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.entries(tools).map(([name, schema]) => ({ name, description: schema.description, inputSchema: schema })),
  }))
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name
    const validate = validators[name]
    if (!validate) return { content: [{ type: 'text', text: `unknown tool ${name}` }], isError: true }
    const result = validate(req.params.arguments ?? {})
    if (!result.valid) {
      // The provider's message names every violation with what was expected
      // and what arrived; returned as the tool result so the model can
      // correct the call instead of giving up.
      return { content: [{ type: 'text', text: `Invalid arguments for ${name}: ${result.errorMessage}` }], isError: true }
    }
    return { content: [{ type: 'text', text: JSON.stringify(handlers[name](result.data)) }] }
  })
  return server
}

const app = new Hono()
const server = buildServer()
const transport = new StreamableHTTPTransport()
app.all('/mcp', async (c) => {
  if (!server.transport) await server.connect(transport)
  return transport.handleRequest(c)
})
app.get('/', (c) => c.text('MCP server at /mcp. Tool inputs are validated by ata-validator, compiled ahead of time.'))

export default app
