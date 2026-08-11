import assert from 'node:assert/strict'
import test from 'node:test'

import { auditAgentEvents } from './agent-audit.mjs'

const completed = (item) => JSON.stringify({ type: 'item.completed', item })

test('records only a sanitized expected MCP call audit', () => {
  const audit = auditAgentEvents([
    completed({ type: 'mcp_tool_call', server: 'weavatrix_refactor', tool: 'rename_symbol', arguments: { confirm_token: 'private' } }),
    completed({ type: 'command_execution', command: 'npm exec tsc -- --noEmit' }),
  ], 'weavatrix')

  assert.deepEqual(audit, {
    expectedServer: 'weavatrix_refactor',
    expectedTool: 'rename_symbol',
    completedMcpCalls: [{ server: 'weavatrix_refactor', tool: 'rename_symbol', count: 1 }],
    fileChangeEvents: 0,
    sourceWriteCommandEvents: 0,
    compliant: true,
    issues: [],
  })
  assert.doesNotMatch(JSON.stringify(audit), /private/)
})

test('rejects tool arms that bypass MCP or never call the required edit tool', () => {
  const audit = auditAgentEvents([
    completed({ type: 'file_change', changes: [{ path: 'private/path.ts', kind: 'update' }] }),
    completed({ type: 'command_execution', command: 'Set-Content src/core.ts changed' }),
  ], 'serena')

  assert.equal(audit.compliant, false)
  assert.equal(audit.fileChangeEvents, 1)
  assert.equal(audit.sourceWriteCommandEvents, 1)
  assert.deepEqual(audit.issues, [
    'MISSING_EXPECTED_MCP_EDIT_CALL',
    'MANUAL_FILE_CHANGE_EVENT',
    'SOURCE_WRITE_COMMAND_EVENT',
  ])
  assert.doesNotMatch(JSON.stringify(audit), /private\/path|Set-Content/)
})

test('allows file changes only for the naked control arm', () => {
  const audit = auditAgentEvents([
    completed({ type: 'file_change', changes: [{ path: 'private/path.ts', kind: 'update' }] }),
  ], 'naked')

  assert.equal(audit.compliant, true)
  assert.equal(audit.expectedServer, null)
  assert.equal(audit.expectedTool, null)
  assert.equal(audit.fileChangeEvents, 1)
})
