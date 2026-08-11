import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const expectedEdit = {
  weavatrix: { server: 'weavatrix_refactor', tool: 'rename_symbol' },
  serena: { server: 'serena', tool: 'rename_symbol' },
  naked: null,
}

const sourceWritePattern = /\b(?:apply_patch|set-content|add-content|out-file|writealltext|writealllines|move-item|copy-item|sed\s+-i|perl\s+-pi|tee)\b/i

export function auditAgentEvents(lines, arm) {
  if (!(arm in expectedEdit)) throw new Error(`unsupported benchmark arm: ${arm}`)
  const expected = expectedEdit[arm]
  const calls = new Map()
  let fileChangeEvents = 0
  let sourceWriteCommandEvents = 0

  for (const line of lines) {
    let event
    try { event = JSON.parse(String(line).replace(/^\uFEFF/, '')) } catch { continue }
    if (event.type !== 'item.completed') continue
    const item = event.item ?? {}
    if (item.type === 'mcp_tool_call' && expected && item.server === expected.server) {
      const key = `${item.server}\0${item.tool}`
      calls.set(key, (calls.get(key) ?? 0) + 1)
    } else if (item.type === 'file_change') {
      fileChangeEvents += 1
    } else if (item.type === 'command_execution' && sourceWritePattern.test(item.command ?? '')) {
      sourceWriteCommandEvents += 1
    }
  }

  const completedMcpCalls = [...calls.entries()].map(([key, count]) => {
    const [server, tool] = key.split('\0')
    return { server, tool, count }
  }).sort((left, right) => `${left.server}/${left.tool}`.localeCompare(`${right.server}/${right.tool}`))
  const expectedCount = expected
    ? calls.get(`${expected.server}\0${expected.tool}`) ?? 0
    : 0
  const issues = []
  if (expected && expectedCount === 0) issues.push('MISSING_EXPECTED_MCP_EDIT_CALL')
  if (expected && fileChangeEvents > 0) issues.push('MANUAL_FILE_CHANGE_EVENT')
  if (expected && sourceWriteCommandEvents > 0) issues.push('SOURCE_WRITE_COMMAND_EVENT')

  return {
    expectedServer: expected?.server ?? null,
    expectedTool: expected?.tool ?? null,
    completedMcpCalls,
    fileChangeEvents,
    sourceWriteCommandEvents,
    compliant: issues.length === 0,
    issues,
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  const [, , eventPath, arm] = process.argv
  if (!eventPath || !arm) throw new Error('usage: node agent-audit.mjs <events.jsonl> <arm>')
  const audit = auditAgentEvents(readFileSync(resolve(eventPath), 'utf8').split(/\r?\n/), arm)
  process.stdout.write(`${JSON.stringify(audit)}\n`)
  if (!audit.compliant) process.exitCode = 2
}
