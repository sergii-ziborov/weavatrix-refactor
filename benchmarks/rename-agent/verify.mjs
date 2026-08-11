// Ground-truth verification: reads the fixture back and grades the rename.
// 7 must-edit sites; 4 traps that must be untouched; tsc must still pass.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const fixture = process.argv[2]
const read = (p) => readFileSync(join(fixture, p), 'utf8')
const core = read('src/core.ts')
const caller = read('src/caller.ts')
const shadow = read('src/shadow.ts')
const toplevel = read('src/toplevel.ts')

const checks = [
  ['core: declaration renamed', /export function locateTarget\(/.test(core)],
  ['core: recursive call renamed', /return locateTarget\(selector\.slice/.test(core)],
  ['core: call inside resolveTargetPath renamed', /return `\/\$\{locateTarget\(selector\)\}`/.test(core)],
  ['caller: import renamed', /import \{ locateTarget, resolveTargetPath \}/.test(caller)],
  ['caller: call renamed', /locateTarget\(input\)/.test(caller)],
  ['toplevel: import renamed', /import \{ locateTarget \}/.test(toplevel)],
  ['toplevel: top-level call renamed', /locateTarget\('#main'\)/.test(toplevel)],
  ['TRAP prefix identifier untouched', /resolveTargetPath/.test(core) && /resolveTargetPath\(input\)/.test(caller)],
  ['TRAP string literal untouched', caller.includes("'call resolveTarget with a selector'")],
  ['TRAP comment untouched', caller.includes('the name inside a comment: resolveTarget is documented')],
  ['TRAP shadow declaration untouched', /function resolveTarget\(node: number\)/.test(shadow) && /return resolveTarget\(node\)/.test(shadow)],
]

let compiles = false
try {
  execFileSync('node', [join(fixture, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', fixture], { stdio: 'pipe' })
  compiles = true
} catch { compiles = false }
checks.push(['tsc --noEmit still passes', compiles])

const passed = checks.filter(([, ok]) => ok).length
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
console.log(`score: ${passed}/${checks.length}`)
process.exit(passed === checks.length ? 0 : 1)
