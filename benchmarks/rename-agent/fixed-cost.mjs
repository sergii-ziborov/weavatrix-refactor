// Session-fixed cost per MCP server: the initialize result (instructions ride there)
// plus the tools/list catalog. Both land in the agent's context once per session,
// before any work happens. Counted in o200k tokens.
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base'

const [, , name, outPath, command, ...args] = process.argv
const server = spawn(command, args, { cwd: process.env.REFBENCH_FIXTURE, env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] })
let buffer = ''
const pending = new Map()
server.stdout.on('data', (chunk) => {
  buffer += chunk.toString()
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    try {
      const message = JSON.parse(line)
      if (pending.has(message.id)) { pending.get(message.id)(line); pending.delete(message.id) }
    } catch { /* partial */ }
  }
})
let nextId = 1
const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++
  pending.set(id, resolve)
  setTimeout(() => reject(new Error(`timeout on ${method}`)), 600000)
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
})

const initRaw = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fc', version: '1' } })
server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
const listRaw = await rpc('tools/list', {})
const init = JSON.parse(initRaw)
const list = JSON.parse(listRaw)
const report = {
  name,
  initializeTokens: countTokens(initRaw),
  instructionsTokens: countTokens(init.result?.instructions ?? ''),
  catalogTokens: countTokens(JSON.stringify(list.result?.tools ?? [])),
  toolCount: list.result?.tools?.length ?? 0,
}
writeFileSync(outPath, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
server.kill()
process.exit(0)
