// What validating the tool calls costs here: the worker bundle, and a fresh
// process from the first import to the first validated tool result, against
// the same server with the validation removed. Run after `npm run tools`.
import { build } from 'esbuild'
import { gzipSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'

async function bundle (entry: string) {
  const out = await build({ entryPoints: [entry], bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, logLevel: 'silent', conditions: ['workerd', 'worker', 'browser'] })
  const text = out.outputFiles[0].text
  return { min: text.length / 1000, gz: gzipSync(text, { level: 9 }).length / 1000 }
}

function coldStart (entry: string) {
  const probe = `
    const t0 = performance.now()
    const { default: app } = await import(${JSON.stringify('./' + entry)})
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
    const post = async (body) => { const r = await app.request('http://localhost/mcp', { method: 'POST', headers, body: JSON.stringify(body) }); const t = await r.text(); const line = t.split('\\n').find((l) => l.startsWith('data:')); return JSON.parse(line ? line.slice(5) : t) }
    await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'measure', version: '0' } } })
    const r = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search_orders', arguments: { customer_id: 'cus_a1b2c3d4e5' } } })
    if (r.result.isError) throw new Error(r.result.content[0].text)
    console.log((performance.now() - t0).toFixed(2))
  `
  const runs: number[] = []
  for (let i = 0; i < 11; i++) runs.push(parseFloat(execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', probe], { encoding: 'utf8' }).trim()))
  runs.sort((a, b) => a - b)
  return runs[5]
}

// The same server without validation: the compiled modules and the provider
// gone, the arguments handed to the tool as they came.
const src = readFileSync('src/index.ts', 'utf8')
const bare = src
  .replace(/import \{ AtaAotJsonSchemaValidator \} from '@ata-project\/mcp\/aot'\n/, '')
  .replace(/import compiled from '\.\/generated\/index\.mjs'\n/, '')
  .replace(/const validator = new AtaAotJsonSchemaValidator[^\n]*\n/, '')
  .replace(/const validators = [^\n]*\n/, '')
  .replace(/const validate = validators\[name\]\n\s*if \(!validate\)[^\n]*\n/, "if (!handlers[name]) return { content: [{ type: 'text', text: `unknown tool ${name}` }], isError: true }\n")
  .replace(/const result = validate\(req\.params\.arguments \?\? \{\}\)\n\s*if \(!result\.valid\) \{[\s\S]*?\n\s*\}\n/, 'const result = { data: (req.params.arguments ?? {}) as Record<string, unknown> }\n')
  .replace(/capabilities: \{ tools: \{\} \}, jsonSchemaValidator: validator/, 'capabilities: { tools: {} }')
if (/validator|compiled/i.test(bare.replace(/\/\/[^\n]*/g, '').replace(/jsonSchemaValidator|c\.text\([^)]*\)/g, ''))) throw new Error('the bare variant still mentions validation; the rewrite missed a line')
writeFileSync('src/index.bare.ts', bare)
// And the same server taking the provider from the package's main entry,
// which requires the runtime engine: what the `/aot` entry is there to avoid.
writeFileSync('src/index.main.ts', src.replace("'@ata-project/mcp/aot'", "'@ata-project/mcp'"))
try {
  const [withV, without, main] = [await bundle('src/index.ts'), await bundle('src/index.bare.ts'), await bundle('src/index.main.ts')]
  console.log(`worker bundle, minified: ${withV.min.toFixed(1)} KB with validation, ${without.min.toFixed(1)} KB without, ${main.min.toFixed(1)} KB with the provider from the main entry`)
  console.log(`worker bundle, gzipped:  ${withV.gz.toFixed(1)} KB with validation, ${without.gz.toFixed(1)} KB without, ${main.gz.toFixed(1)} KB with the provider from the main entry`)
  const a = coldStart('src/index.ts'); const b = coldStart('src/index.bare.ts')
  console.log(`fresh process to the first tool result: ${a.toFixed(1)} ms with validation, ${b.toFixed(1)} ms without (medians of 11)`)
} finally {
  rmSync('src/index.bare.ts', { force: true })
  rmSync('src/index.main.ts', { force: true })
}
