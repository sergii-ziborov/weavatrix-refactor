import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const HERE = dirname(fileURLToPath(import.meta.url))

const cases = [
  {
    language: 'typescript',
    fixture: 'fixture',
    edits: {
      'src/core.ts': [
        ['export function resolveTarget(', 'export function locateTarget('],
        ['return resolveTarget(selector.slice', 'return locateTarget(selector.slice'],
        ['/${resolveTarget(selector)}', '/${locateTarget(selector)}'],
      ],
      'src/caller.ts': [
        ['import { resolveTarget, resolveTargetPath }', 'import { locateTarget, resolveTargetPath }'],
        ['return resolveTarget(input)', 'return locateTarget(input)'],
      ],
      'src/toplevel.ts': [
        ['import { resolveTarget }', 'import { locateTarget }'],
        ["resolveTarget('#main')", "locateTarget('#main')"],
      ],
    },
  },
  {
    language: 'rust',
    fixture: 'fixtures/rust',
    edits: {
      'src/core.rs': [
        ['pub fn resolve_target(', 'pub fn locate_target('],
        ['return resolve_target(&selector[1..])', 'return locate_target(&selector[1..])'],
        ['resolve_target(selector)', 'locate_target(selector)'],
      ],
      'src/caller.rs': [
        ['use crate::core::{resolve_target, resolve_target_path};', 'use crate::core::{locate_target, resolve_target_path};'],
        ['let value = resolve_target(input);', 'let value = locate_target(input);'],
      ],
      'src/toplevel.rs': [
        ['use crate::core::resolve_target;', 'use crate::core::locate_target;'],
        ['resolve_target("#main")', 'locate_target("#main")'],
      ],
    },
  },
  {
    language: 'python',
    fixture: 'fixtures/python',
    edits: {
      'src/core.py': [
        ['def resolve_target(', 'def locate_target('],
        ['return resolve_target(selector[1:])', 'return locate_target(selector[1:])'],
        ['{resolve_target(selector)}', '{locate_target(selector)}'],
      ],
      'src/caller.py': [
        ['from src.core import resolve_target, resolve_target_path', 'from src.core import locate_target, resolve_target_path'],
        ['return resolve_target(value)', 'return locate_target(value)'],
      ],
      'src/toplevel.py': [
        ['from src.core import resolve_target', 'from src.core import locate_target'],
        ['resolve_target("#main")', 'locate_target("#main")'],
      ],
    },
  },
]

function grade(language, fixture) {
  const result = spawnSync(process.execPath, [join(HERE, 'verify.mjs'), language, fixture, '--json'], {
    cwd: HERE,
    encoding: 'utf8',
  })
  assert.match(result.stdout, /^\s*\{/, result.stderr || result.stdout)
  return { exitCode: result.status, report: JSON.parse(result.stdout) }
}

for (const specimen of cases) {
  test(`${specimen.language} grader rejects the untouched fixture and accepts the exact rename`, () => {
    const source = join(HERE, specimen.fixture)
    if (specimen.language === 'typescript' && !existsSync(join(source, 'node_modules', 'typescript'))) {
      const npm = process.platform === 'win32' ? process.env.ComSpec : 'npm'
      const npmArgs = process.platform === 'win32'
        ? ['/d', '/s', '/c', `npm.cmd ci --ignore-scripts --no-audit --no-fund --prefix "${source}"`]
        : ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', source]
      const installed = spawnSync(npm, npmArgs, {
        cwd: HERE,
        encoding: 'utf8',
      })
      assert.equal(installed.status, 0, installed.stderr || installed.stdout)
    }
    const baseline = grade(specimen.language, source)
    assert.equal(baseline.exitCode, 1)
    assert.equal(baseline.report.score, '5/12')

    const target = mkdtempSync(join(tmpdir(), `wvxr-grader-${specimen.language}-`))
    cpSync(source, target, { recursive: true })
    for (const [relativePath, edits] of Object.entries(specimen.edits)) {
      const path = join(target, relativePath)
      let contents = readFileSync(path, 'utf8')
      for (const [before, after] of edits) {
        assert.ok(contents.includes(before), `${relativePath} is missing ${before}`)
        contents = contents.replace(before, after)
      }
      writeFileSync(path, contents)
    }

    const renamed = grade(specimen.language, target)
    assert.equal(renamed.exitCode, 0)
    assert.equal(renamed.report.score, '12/12')
  })
}
