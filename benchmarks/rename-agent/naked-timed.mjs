// The naked-agent baseline, measured rather than assumed.
//
// An agent's wall time has two components: the mechanical tool time (grep, read,
// write - measured here with hrtime) and the model time (prefill for everything
// entering context, decode for everything the model writes). Model speeds are
// parameters, not measurements - stated in the report - because they belong to
// the model serving the agent, not to any contender.
//
// The rename itself is performed for real (word-boundary, code-only lines by the
// simple rule an agent would apply), so the write half is real bytes, and the
// fixture afterwards can be graded by verify.mjs like every other contender.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base'

const fixture = process.argv[2]
const started = process.hrtime.bigint()

// 1. grep -n resolveTarget across src (output enters the model's context)
const files = readdirSync(join(fixture, 'src')).filter((f) => f.endsWith('.ts')).map((f) => `src/${f}`)
let grepOut = ''
for (const file of files) {
  readFileSync(join(fixture, file), 'utf8').split('\n').forEach((text, i) => {
    if (/\bresolveTarget\b/.test(text)) grepOut += `${file}:${i + 1}:${text}\n`
  })
}

// 2. read every file the grep named, fully (contents enter context)
const candidates = [...new Set(grepOut.trim().split('\n').map((l) => l.split(':')[0]))]
const contents = new Map(candidates.map((f) => [f, readFileSync(join(fixture, f), 'utf8')]))

// 3. the model decides and rewrites the files that change (full new contents leave
//    the model as completion). The decision applied: rename word-boundary matches
//    except in shadow.ts, except inside quotes and comments.
let written = ''
for (const [file, text] of contents) {
  if (file === 'src/shadow.ts') continue
  const next = text.split('\n').map((line) => {
    const comment = line.indexOf('//')
    const head = comment >= 0 ? line.slice(0, comment) : line
    const tail = comment >= 0 ? line.slice(comment) : ''
    // strings: skip segments inside quotes (the toy rule a careful agent applies)
    const replaced = head.split(/('[^']*')/).map((part) =>
      part.startsWith("'") ? part : part.replace(/\bresolveTarget\b/g, 'locateTarget')).join('')
    return replaced + tail
  }).join('\n')
  if (next !== text) {
    writeFileSync(join(fixture, file), next)
    written += next
  }
}
const mechanicalMs = Number(process.hrtime.bigint() - started) / 1e6

const inputText = grepOut + [...contents.values()].join('')
const report = {
  name: 'naked-agent',
  mechanicalMs: Math.round(mechanicalMs * 100) / 100,
  inputTokens: countTokens(inputText),
  outputTokens: countTokens(written),
  filesRead: candidates.length,
  filesRewritten: written ? [...contents.keys()].filter((f) => f !== 'src/shadow.ts').length : 0,
}
writeFileSync(join(fixture, '..', 'naked-timed.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
