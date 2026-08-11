// Unified ground-truth grader. Every language has the same shape:
// seven required edits, four traps that must stay untouched, and one build gate.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const languages = new Set(['typescript', 'rust', 'python'])
const requestedLanguage = languages.has(process.argv[2]) ? process.argv[2] : 'typescript'
const fixture = languages.has(process.argv[2]) ? process.argv[3] : process.argv[2]
const jsonOutput = process.argv.includes('--json')

if (!fixture) {
  console.error('usage: node verify.mjs [typescript|rust|python] <fixture> [--json]')
  process.exit(2)
}

const read = (relativePath) => readFileSync(join(fixture, relativePath), 'utf8')
const build = (command, args) => spawnSync(command, args, {
  cwd: fixture,
  encoding: 'utf8',
  windowsHide: true,
}).status === 0

function gradeTypeScript() {
  const core = read('src/core.ts')
  const caller = read('src/caller.ts')
  const shadow = read('src/shadow.ts')
  const toplevel = read('src/toplevel.ts')
  return [
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
    ['tsc --noEmit still passes', build(process.execPath, [join(fixture, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', fixture])],
  ]
}

function gradeRust() {
  const core = read('src/core.rs')
  const caller = read('src/caller.rs')
  const shadow = read('src/shadow.rs')
  const toplevel = read('src/toplevel.rs')
  return [
    ['core: declaration renamed', /pub fn locate_target\(/.test(core)],
    ['core: recursive call renamed', /return locate_target\(&selector\[1\.\.\]\)/.test(core)],
    ['core: call inside resolve_target_path renamed', /format!\("\/\{\}", locate_target\(selector\)\)/.test(core)],
    ['caller: import renamed', /use crate::core::\{locate_target, resolve_target_path\};/.test(caller)],
    ['caller: call renamed', /let value = locate_target\(input\);/.test(caller)],
    ['toplevel: import renamed', /use crate::core::locate_target;/.test(toplevel)],
    ['toplevel: call renamed', /locate_target\("#main"\)/.test(toplevel)],
    ['TRAP prefix identifier untouched', /resolve_target_path/.test(core) && /resolve_target_path\(input\)/.test(caller)],
    ['TRAP string literal untouched', caller.includes('"call resolve_target with a selector"')],
    ['TRAP comment untouched', caller.includes('the name inside a comment: resolve_target is documented')],
    ['TRAP shadow declaration untouched', /fn resolve_target\(node: u32\)/.test(shadow) && /resolve_target\(node\)/.test(shadow)],
    ['cargo check still passes', build('cargo', ['check', '--quiet', '--offline', '--locked'])],
  ]
}

function gradePython() {
  const core = read('src/core.py')
  const caller = read('src/caller.py')
  const shadow = read('src/shadow.py')
  const toplevel = read('src/toplevel.py')
  const python = process.env.REFBENCH_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')
  return [
    ['core: declaration renamed', /def locate_target\(/.test(core)],
    ['core: recursive call renamed', /return locate_target\(selector\[1:\]\)/.test(core)],
    ['core: call inside resolve_target_path renamed', /return f"\/\{locate_target\(selector\)\}"/.test(core)],
    ['caller: import renamed', /from src\.core import locate_target, resolve_target_path/.test(caller)],
    ['caller: call renamed', /return locate_target\(value\)/.test(caller)],
    ['toplevel: import renamed', /from src\.core import locate_target/.test(toplevel)],
    ['toplevel: module-level call renamed', /DEFAULT_TARGET = locate_target\("#main"\)/.test(toplevel)],
    ['TRAP prefix identifier untouched', /resolve_target_path/.test(core) && /resolve_target_path\(value\)/.test(caller)],
    ['TRAP string literal untouched', caller.includes('"call resolve_target with a selector"')],
    ['TRAP comment untouched', caller.includes('the name inside a comment: resolve_target is documented')],
    ['TRAP shadow declaration untouched', /def resolve_target\(node: int\)/.test(shadow) && /return resolve_target\(node\)/.test(shadow)],
    ['python unittest still passes', build(python, ['-m', 'unittest', 'discover', '-s', 'tests', '-q'])],
  ]
}

const checks = {
  typescript: gradeTypeScript,
  rust: gradeRust,
  python: gradePython,
}[requestedLanguage]()
const passed = checks.filter(([, ok]) => ok).length
const report = {
  language: requestedLanguage,
  score: `${passed}/${checks.length}`,
  passed,
  total: checks.length,
  checks: checks.map(([name, ok]) => ({ name, passed: ok })),
}

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2))
} else {
  for (const { name, passed: ok } of report.checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  console.log(`score: ${report.score}`)
}
process.exit(passed === checks.length ? 0 : 1)
