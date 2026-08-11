// MCP stdio driver: spawns a server, runs a scripted tool sequence, and records
// wall time plus the exact request/response texts. summarize.mjs tokenizes those
// texts with o200k_base; byte counts remain transport diagnostics only.
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { protocolTokenMetrics } from './token-metrics.mjs'

const [, , configPath, outPath] = process.argv
const config = (await import(`file://${configPath.replaceAll('\\', '/')}`)).default

const server = spawn(config.command, config.args, {
  cwd: config.cwd,
  env: { ...process.env, ...(config.env ?? {}) },
  stdio: ['pipe', 'pipe', 'pipe'],
})
let stderrTail = ''
server.stderr.on('data', (d) => { stderrTail = (stderrTail + d.toString()).slice(-4000) })

let buffer = ''
const pending = new Map()
server.stdout.on('data', (chunk) => {
  buffer += chunk.toString()
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    let message
    try { message = JSON.parse(line) } catch { continue }
    if (message.id !== undefined && pending.has(message.id)) {
      const entry = pending.get(message.id)
      pending.delete(message.id)
      entry.resolve({ message, bytes: Buffer.byteLength(line), raw: line })
    }
  }
})

let nextId = 1
function rpc(method, params, timeoutMs = 180000) {
  const id = nextId++
  const body = JSON.stringify({ jsonrpc: '2.0', id, method, params })
  const started = process.hrtime.bigint()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`timeout on ${method} after ${timeoutMs}ms; stderr tail: ${stderrTail.slice(-800)}`))
    }, timeoutMs)
    pending.set(id, {
      resolve: ({ message, bytes, raw }) => {
        clearTimeout(timer)
        const ms = Number(process.hrtime.bigint() - started) / 1e6
        resolve({ message, ms, requestBytes: Buffer.byteLength(body), responseBytes: bytes, raw })
      },
    })
    server.stdin.write(body + '\n')
  })
}

const report = {
  name: config.name,
  tokenizer: 'o200k_base via gpt-tokenizer 3.4.0',
  startupMs: null,
  calls: [],
  toolCount: null,
  error: null,
}
try {
  const bootStart = process.hrtime.bigint()
  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'refbench', version: '1' },
  }, config.initTimeoutMs ?? 240000)
  report.startupMs = Number(process.hrtime.bigint() - bootStart) / 1e6
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  const listed = await rpc('tools/list', {})
  const tools = listed.message.result?.tools ?? []
  report.toolCount = tools.length
  report.toolNames = tools.map((t) => t.name)
  report.listBytes = listed.responseBytes
  const fixedTokens = protocolTokenMetrics({
    initializeRaw: init.raw,
    instructions: init.message.result?.instructions ?? '',
    tools,
    requestText: '',
    responseText: '',
  })
  report.sessionFixedTokens = {
    initialize: fixedTokens.initializeTokens,
    instructionsWithinInitialize: fixedTokens.instructionsTokensWithinInitialize,
    catalog: fixedTokens.catalogTokens,
    total: fixedTokens.sessionFixedContextTokens,
  }

  const state = {}
  for (const step of config.steps) {
    const args = typeof step.arguments === 'function' ? step.arguments(state) : step.arguments
    if (args === null) { report.calls.push({ tool: step.tool, skipped: true }); continue }
    const reply = await rpc('tools/call', { name: step.tool, arguments: args }, step.timeoutMs ?? 180000)
    const result = reply.message.result
    const text = result?.content?.map((c) => c.text ?? '').join('') ?? ''
    const requestText = JSON.stringify({ name: step.tool, arguments: args })
    const responseText = JSON.stringify(result ?? reply.message.error ?? null)
    const tokens = protocolTokenMetrics({
      initializeRaw: '',
      instructions: '',
      tools: [],
      requestText,
      responseText,
    })
    const entry = {
      tool: step.tool,
      label: step.label ?? step.tool,
      ms: Math.round(reply.ms * 10) / 10,
      requestBytes: reply.requestBytes,
      responseBytes: reply.responseBytes,
      requestTokens: tokens.requestTokens,
      responseTokens: tokens.responseTokens,
      taskTokens: tokens.taskTokens,
      isError: result?.isError ?? false,
      protocolError: reply.message.error ?? null,
    }
    if (process.env.REFBENCH_CAPTURE === '1') {
      entry.requestText = requestText
      entry.responseText = responseText
    }
    if (step.capture) step.capture(state, result, text)
    if (step.record) entry.recorded = step.record(state, result, text)
    report.calls.push(entry)
  }
  report.taskTokens = {
    requests: report.calls.reduce((sum, call) => sum + (call.requestTokens ?? 0), 0),
    responses: report.calls.reduce((sum, call) => sum + (call.responseTokens ?? 0), 0),
    total: report.calls.reduce((sum, call) => sum + (call.taskTokens ?? 0), 0),
  }
} catch (error) {
  report.error = String(error?.message ?? error)
} finally {
  server.kill()
}
writeFileSync(outPath, JSON.stringify(report, null, 2))
console.log(`${report.name}: startup ${Math.round(report.startupMs ?? -1)}ms, ${report.calls.length} calls${report.error ? ', ERROR: ' + report.error.slice(0, 200) : ''}`)
