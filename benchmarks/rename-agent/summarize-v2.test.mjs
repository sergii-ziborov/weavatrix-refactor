import assert from 'node:assert/strict'
import test from 'node:test'

import { parseJsonText, summarizeAgentRuns, summarizeProtocolRuns } from './summarize-v2.mjs'

test('accepts PowerShell UTF-8 JSON with a BOM', () => {
  assert.deepEqual(parseJsonText('\uFEFF{"score":"12/12"}'), { score: '12/12' })
})

test('protocol summary keeps context, generated calls, correctness, and milliseconds separate', () => {
  const runs = [30, 10, 20].map((startupMs, index) => ({
    startupMs,
    calls: [{ ms: index + 1 }],
    sessionFixedTokens: { total: 100, catalog: 80, initialize: 20 },
    taskTokens: { requests: 10 + index, responses: 40 + index, total: 50 + (2 * index) },
    benchmark: { arm: 'weavatrix', language: 'rust', grade: { score: '12/12', passed: 12, total: 12 } },
  }))

  assert.deepEqual(summarizeProtocolRuns(runs), [{
    arm: 'weavatrix',
    language: 'rust',
    runs: 3,
    correctRuns: 3,
    operationallySuccessfulRuns: 3,
    scores: ['12/12', '12/12', '12/12'],
    medianStartupMs: 20,
    medianTaskMs: 2,
    medianTransportMs: 23,
    medianFixedContextTokens: 100,
    medianTaskRequestTokens: 11,
    medianTaskResponseTokens: 41,
    medianTotalProtocolTokens: 152,
  }])
})

test('agent summary uses reported usage without adding protocol tokens again', () => {
  const runs = [
    { arm: 'naked', language: 'python', wallMs: 300, exitCode: 0, gradeExitCode: 0, grade: { score: '12/12', passed: 12, total: 12 }, usage: { input_tokens: 90, cached_input_tokens: 50, output_tokens: 8, reasoning_output_tokens: 2 }, toolAudit: { compliant: true } },
    { arm: 'naked', language: 'python', wallMs: 100, exitCode: 0, gradeExitCode: 0, grade: { score: '11/12', passed: 11, total: 12 }, usage: { input_tokens: 70, cached_input_tokens: 40, output_tokens: 6, reasoning_output_tokens: 1 }, toolAudit: { compliant: true } },
    { arm: 'naked', language: 'python', wallMs: 200, exitCode: -1, gradeExitCode: 0, grade: { score: '12/12', passed: 12, total: 12 }, usage: { input_tokens: 80, cached_input_tokens: 45, output_tokens: 7, reasoning_output_tokens: 3 }, toolAudit: { compliant: true } },
  ]

  assert.deepEqual(summarizeAgentRuns(runs), [{
    arm: 'naked',
    language: 'python',
    runs: 3,
    correctRuns: 2,
    operationallySuccessfulRuns: 1,
    scores: ['12/12', '11/12', '12/12'],
    medianWallMs: 200,
    medianInputTokens: 80,
    medianCachedInputTokens: 45,
    medianOutputTokens: 7,
    medianReasoningOutputTokens: 2,
  }])
})
