// Compiles every tool's inputSchema into a module that imports nothing, plus
// the index the provider takes. Run before dev, test and deploy.
import { compileTools } from '@ata-project/mcp/build'
import tools from '../schemas/tools.json' with { type: 'json' }

const result = await compileTools({ tools, outDir: 'src/generated', format: 'esm' })
for (const d of result.declined) console.error(`declined ${d.name}: ${d.reason}`)
if (result.declined.length) process.exit(1)
console.log(`compiled ${result.compiled.length} tool schemas into ${result.index}`)
