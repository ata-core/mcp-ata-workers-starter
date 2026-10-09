import { describe, expect, it } from 'vitest'
import app from '../src/index.ts'

const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
let session: string | null = null
let id = 0
async function rpc (method: string, params: unknown = {}) {
  const res = await app.request('http://localhost/mcp', {
    method: 'POST',
    headers: session ? { ...headers, 'mcp-session-id': session } : headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  })
  session = res.headers.get('mcp-session-id') ?? session
  const text = await res.text()
  // Streamable HTTP answers JSON or an SSE event carrying the JSON.
  const line = text.startsWith('event:') || text.startsWith('data:') ? text.split('\n').find((l) => l.startsWith('data:'))!.slice(5) : text
  return { status: res.status, body: JSON.parse(line) }
}

describe('mcp on workers with ata', () => {
  it('initializes and lists the tools with their JSON Schema', async () => {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
    expect(init.status).toBe(200)
    expect(init.body.result.serverInfo.name).toBe('mcp-ata-workers-starter')
    await app.request('http://localhost/mcp', { method: 'POST', headers: { ...headers, 'mcp-session-id': session! }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })
    const list = await rpc('tools/list')
    const names = list.body.result.tools.map((t: { name: string }) => t.name).sort()
    expect(names).toEqual(['search_orders', 'send_receipt'])
    const search = list.body.result.tools.find((t: { name: string }) => t.name === 'search_orders')
    expect(search.inputSchema.properties.customer_id.pattern).toBe('^cus_[a-z0-9]{8,}$')
  })

  it('runs a valid call', async () => {
    const r = await rpc('tools/call', { name: 'search_orders', arguments: { customer_id: 'cus_a1b2c3d4e5', status: 'open' } })
    expect(r.body.result.isError).toBeFalsy()
    expect(JSON.parse(r.body.result.content[0].text).customer_id).toBe('cus_a1b2c3d4e5')
  })

  it('refuses an invalid call with a message the model can act on', async () => {
    const r = await rpc('tools/call', { name: 'send_receipt', arguments: { order_id: 'nope', email: 'not-an-email', note: 'x'.repeat(300) } })
    expect(r.body.result.isError).toBe(true)
    const text: string = r.body.result.content[0].text
    expect(text).toContain('Invalid arguments for send_receipt')
    expect(text).toMatch(/order_id/)
    expect(text).toMatch(/email/)
    expect(text).toMatch(/note/)
  })
})

describe('the worker bundle', () => {
  it('carries the compiled tools and no validator engine', async () => {
    const { build } = await import('esbuild')
    const out = await build({ entryPoints: ['src/index.ts'], bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, logLevel: 'silent', conditions: ['workerd', 'worker', 'browser'], metafile: true })
    const files = Object.keys(out.metafile!.inputs)
    expect(files.some((f) => f.includes('node_modules/ata-validator/'))).toBe(false)
    expect(files.some((f) => f.endsWith('@ata-project/mcp/aot.js'))).toBe(true)
    expect(files.some((f) => f.endsWith('src/generated/search_orders.validator.mjs'))).toBe(true)
    // The SDK's own default provider is in the bundle, never constructed: the
    // server is handed ours. Nothing of ata's calls new Function.
    const ours = files.filter((f) => f.includes('@ata-project/mcp/') || f.includes('src/generated/'))
    const { readFileSync } = await import('node:fs')
    for (const f of ours) expect(readFileSync(f, 'utf8').includes('new Function'), f).toBe(false)
  })
})
