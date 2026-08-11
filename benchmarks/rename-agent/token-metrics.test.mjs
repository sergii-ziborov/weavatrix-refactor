import assert from 'node:assert/strict'
import test from 'node:test'
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base'

import { protocolTokenMetrics } from './token-metrics.mjs'

test('counts fixed context and task traffic as o200k tokens', () => {
  const initializeRaw = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: { instructions: 'Preview first, then apply with the token.' },
  })
  const tools = [{
    name: 'rename_symbol',
    description: 'Rename one exact symbol.',
    inputSchema: { type: 'object', properties: { symbol: { type: 'string' } } },
  }]
  const requestText = JSON.stringify({ name: 'rename_symbol', arguments: { symbol: 'fn:src/core.ts:1:resolveTarget' } })
  const responseText = JSON.stringify({ content: [{ type: 'text', text: 'PARTIAL' }] })

  const metrics = protocolTokenMetrics({
    initializeRaw,
    instructions: 'Preview first, then apply with the token.',
    tools,
    requestText,
    responseText,
  })

  assert.deepEqual(metrics, {
    initializeTokens: countTokens(initializeRaw),
    instructionsTokensWithinInitialize: countTokens('Preview first, then apply with the token.'),
    catalogTokens: countTokens(JSON.stringify(tools)),
    sessionFixedContextTokens: countTokens(initializeRaw) + countTokens(JSON.stringify(tools)),
    requestTokens: countTokens(requestText),
    responseTokens: countTokens(responseText),
    taskTokens: countTokens(requestText) + countTokens(responseText),
  })
})
