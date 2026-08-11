import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const armOrder = ['weavatrix', 'serena', 'serena-warm', 'naked']
const languageOrder = ['typescript', 'rust', 'python']

export function parseJsonText(text) {
  return JSON.parse(text.replace(/^\uFEFF/, ''))
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right)
  return sorted.length === 0 ? null : sorted[Math.floor(sorted.length / 2)]
}

function grouped(runs, identity) {
  const groups = new Map()
  for (const run of runs) {
    const { arm, language } = identity(run)
    const key = `${arm}\0${language}`
    if (!groups.has(key)) groups.set(key, { arm, language, runs: [] })
    groups.get(key).runs.push(run)
  }
  return [...groups.values()].sort((left, right) => {
    const arm = armOrder.indexOf(left.arm) - armOrder.indexOf(right.arm)
    return arm || languageOrder.indexOf(left.language) - languageOrder.indexOf(right.language)
  })
}

export function summarizeProtocolRuns(runs) {
  return grouped(runs, (run) => run.benchmark).map((group) => {
    const taskMs = group.runs.map((run) => run.calls.reduce((sum, call) => sum + (call.ms ?? 0), 0))
    const startupMs = group.runs.map((run) => run.startupMs)
    return {
      arm: group.arm,
      language: group.language,
      runs: group.runs.length,
      correctRuns: group.runs.filter((run) => run.benchmark.grade.passed === run.benchmark.grade.total).length,
      operationallySuccessfulRuns: group.runs.filter((run) => (
        run.benchmark.grade.passed === run.benchmark.grade.total
        && !run.error
        && run.calls.every((call) => !call.isError && !call.protocolError)
      )).length,
      scores: group.runs.map((run) => run.benchmark.grade.score),
      medianStartupMs: Math.round(median(startupMs)),
      medianTaskMs: Math.round(median(taskMs)),
      medianTransportMs: Math.round(median(group.runs.map((run, index) => startupMs[index] + taskMs[index]))),
      medianFixedContextTokens: median(group.runs.map((run) => run.sessionFixedTokens.total)),
      medianTaskRequestTokens: median(group.runs.map((run) => run.taskTokens.requests)),
      medianTaskResponseTokens: median(group.runs.map((run) => run.taskTokens.responses)),
      medianTotalProtocolTokens: median(group.runs.map((run) => run.sessionFixedTokens.total + run.taskTokens.total)),
    }
  })
}

export function summarizeAgentRuns(runs) {
  return grouped(runs, (run) => run).map((group) => ({
    arm: group.arm,
    language: group.language,
    runs: group.runs.length,
    correctRuns: group.runs.filter((run) => run.grade.passed === run.grade.total).length,
    operationallySuccessfulRuns: group.runs.filter((run) => (
      run.grade.passed === run.grade.total
      && run.exitCode === 0
      && run.gradeExitCode === 0
      && run.usage
      && run.toolAudit?.compliant === true
    )).length,
    scores: group.runs.map((run) => run.grade.score),
    medianWallMs: median(group.runs.map((run) => run.wallMs)),
    medianInputTokens: median(group.runs.map((run) => run.usage?.input_tokens)),
    medianCachedInputTokens: median(group.runs.map((run) => run.usage?.cached_input_tokens)),
    medianOutputTokens: median(group.runs.map((run) => run.usage?.output_tokens)),
    medianReasoningOutputTokens: median(group.runs.map((run) => run.usage?.reasoning_output_tokens)),
  }))
}

function readJsonFiles(directory, predicate) {
  if (!existsSync(directory)) return []
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json') && predicate(name))
    .map((name) => parseJsonText(readFileSync(join(directory, name), 'utf8')))
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  const [, , protocolDirectory, agentDirectory, outputPath] = process.argv
  if (!protocolDirectory || !agentDirectory || !outputPath) {
    throw new Error('usage: node summarize-v2.mjs <protocol-dir> <agent-dir> <output.json>')
  }
  const protocolRuns = readJsonFiles(resolve(protocolDirectory), () => true)
    .filter((run) => run.benchmark?.grade)
  const agentRuns = readJsonFiles(resolve(agentDirectory), (name) => name !== 'agent-matrix.json')
    .filter((run) => run.grade && run.arm)
  const metadataPath = join(resolve(agentDirectory), 'agent-matrix.json')
  const metadata = existsSync(metadataPath) ? parseJsonText(readFileSync(metadataPath, 'utf8')) : {}
  const report = {
    schema: 'weavatrix.rename-agent-benchmark.summary.v2',
    generatedAt: new Date().toISOString(),
    tokenizer: 'o200k_base via gpt-tokenizer 3.4.0 for protocol; cumulative turn.completed usage for agents',
    model: metadata.model ?? null,
    reasoningEffort: metadata.reasoningEffort ?? null,
    cliVersion: metadata.cliVersion ?? null,
    serenaCommit: metadata.serenaCommit ?? 'f1d78a88cec2031d6b699c9944839979e9a0175d',
    protocol: summarizeProtocolRuns(protocolRuns),
    agents: summarizeAgentRuns(agentRuns),
    accounting: {
      protocol: 'Fixed initialize/catalog context, tool-call arguments, and tool results are exact and separate. Timings contain only server startup plus tool calls.',
      agents: 'Input, cached input, output, and reasoning output are reported by Codex. MCP catalog and instructions are already inside agent input usage and are never added again.',
      comparison: 'Protocol-only timings exclude model planning. Agent wall time includes model planning, tool calls, edits, and verification.',
    },
  }
  writeFileSync(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`wrote ${resolve(outputPath)}`)
}
