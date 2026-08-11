import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base'

const [, , rawDirectory, nakedRunsPath, outputPath] = process.argv
if (!rawDirectory || !nakedRunsPath || !outputPath) {
  throw new Error('usage: node summarize.mjs <raw-dir> <naked-runs.json> <output.json>')
}

const raw = resolve(rawDirectory)
const readRaw = (name) => JSON.parse(readFileSync(join(raw, name), 'utf8'))
const median = (values) => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)]

function captureTokens(capture) {
  let context = 0
  let toolCalls = 0
  for (const call of capture.calls) {
    if (call.skipped || !call.requestText) continue
    toolCalls += countTokens(call.requestText)
    context += countTokens(call.responseText ?? '')
  }
  return { context, toolCalls }
}

function timing(prefix, runCount) {
  const runs = []
  for (let index = 1; index <= runCount; index += 1) {
    const path = join(raw, `${prefix}${index}.json`)
    if (!existsSync(path)) continue
    const run = JSON.parse(readFileSync(path, 'utf8'))
    runs.push({
      startupMs: Math.round(run.startupMs),
      taskMs: Math.round(run.calls.reduce((sum, call) => sum + (call.ms ?? 0), 0)),
    })
  }
  if (runs.length === 0) throw new Error(`no timing runs for ${prefix}`)
  return {
    runs,
    medianStartupMs: median(runs.map((run) => run.startupMs)),
    medianTaskMs: median(runs.map((run) => run.taskMs)),
    medianTransportMs: median(runs.map((run) => run.startupMs + run.taskMs)),
  }
}

function mcpRow(name, captureFile, timingPrefix, fixedFile, correctness, runCount = 3) {
  const fixed = readRaw(fixedFile)
  return {
    name,
    correctness,
    sessionFixedContextTokens: fixed.initializeTokens + fixed.catalogTokens,
    initializeTokens: fixed.initializeTokens,
    instructionsTokensWithinInitialize: fixed.instructionsTokens,
    catalogTokens: fixed.catalogTokens,
    taskTokens: captureTokens(readRaw(captureFile)),
    timing: timing(timingPrefix, runCount),
  }
}

const mcp = [
  mcpRow('weavatrix-refactor 1.0.4', 'cap-wvxr104.json', 'wvxr104-run', 'fixed-wvxr.json', '12/12 x3'),
  mcpRow('weavatrix-refactor-js 0.1.6', 'cap-js.json', 'js-run', 'fixed-js.json', '12/12 x3'),
  mcpRow('Serena suggested flow', 'cap-serena.json', 'serena-run', 'fixed-serena.json', '7/12 x3; silent half-rename'),
]

const warmCapture = readRaw('cap-serena-warm.json')
const warmFixed = readRaw('fixed-serena.json')
const warmTaskMs = Math.round(warmCapture.calls.reduce((sum, call) => sum + (call.ms ?? 0), 0))
mcp.push({
  name: 'Serena warmed by hand',
  correctness: '12/12 x1',
  sessionFixedContextTokens: warmFixed.initializeTokens + warmFixed.catalogTokens,
  initializeTokens: warmFixed.initializeTokens,
  instructionsTokensWithinInitialize: warmFixed.instructionsTokens,
  catalogTokens: warmFixed.catalogTokens,
  taskTokens: captureTokens(warmCapture),
  timing: {
    runs: [{ startupMs: Math.round(warmCapture.startupMs), taskMs: warmTaskMs }],
    medianStartupMs: Math.round(warmCapture.startupMs),
    medianTaskMs: warmTaskMs,
    medianTransportMs: Math.round(warmCapture.startupMs) + warmTaskMs,
  },
  limitation: 'single capture; includes three manual language-server warm-up calls',
})

function finalUsage(eventPath) {
  const lines = readFileSync(eventPath, 'utf8').split(/\r?\n/)
  let usage = null
  for (const line of lines) {
    if (!line.trim().startsWith('{')) continue
    try {
      const event = JSON.parse(line)
      if (event.type === 'turn.completed') usage = event.usage
    } catch {
      // Native stderr may be interleaved by PowerShell; only JSON events count.
    }
  }
  if (!usage) throw new Error(`no turn.completed usage in ${eventPath}`)
  return usage
}

const nakedMetadataPath = resolve(nakedRunsPath)
const nakedMetadata = JSON.parse(readFileSync(nakedMetadataPath, 'utf8'))
const nakedRuns = nakedMetadata.runs.map((run) => ({
  wallMs: run.wallMs,
  score: run.score,
  ...finalUsage(resolve(dirname(nakedMetadataPath), run.events)),
}))
const nakedAgent = {
  cliVersion: nakedMetadata.cliVersion,
  model: nakedMetadata.model,
  prompt: nakedMetadata.prompt,
  runs: nakedRuns,
  medianWallMs: median(nakedRuns.map((run) => run.wallMs)),
  medianInputTokens: median(nakedRuns.map((run) => run.input_tokens)),
  medianCachedInputTokens: median(nakedRuns.map((run) => run.cached_input_tokens)),
  medianOutputTokens: median(nakedRuns.map((run) => run.output_tokens)),
  medianReasoningOutputTokens: median(nakedRuns.map((run) => run.reasoning_output_tokens)),
  correctness: '12/12 x3',
}

const mechanical = readRaw('naked-timed.json')
const report = {
  schema: 'weavatrix.rename-agent-benchmark.v1',
  date: '2026-08-11',
  tokenizer: 'o200k_base via gpt-tokenizer 3.4.0',
  mcpProtocolLayer: mcp,
  nakedCodexAgent: nakedAgent,
  deterministicNakedOracle: mechanical,
  comparability: {
    mcpProtocolLayer: 'scripted server wall time and exact MCP-visible tokens; excludes model planning and common host context',
    nakedCodexAgent: 'measured full agent wall time and cumulative model usage; includes common host context, repeated model steps, tool use, and build verification',
    warning: 'Do not add a modeled token latency to MCP server time or rank it directly against the real agent wall time.',
  },
}

writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(`wrote ${outputPath}`)
console.log(`naked Codex median: ${nakedAgent.medianWallMs} ms, ${nakedAgent.medianInputTokens} input tokens, ${nakedAgent.medianOutputTokens} output tokens`)
