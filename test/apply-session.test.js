import {test, beforeEach} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {applyPlan, dryRunPlan} from '../src/apply-session.mjs'
import {rollbackLastApply} from '../src/rollback.mjs'
import {sha256Hex} from '../src/refactor-home.mjs'

let repoRoot

beforeEach(() => {
    process.env.WEAVATRIX_REFACTOR_HOME = mkdtempSync(join(tmpdir(), 'wvx-refactor-home-'))
    repoRoot = mkdtempSync(join(tmpdir(), 'wvx-refactor-repo-'))
})

const writeRepoFile = (path, content) => {
    const absolute = join(repoRoot, path)
    mkdirSync(join(absolute, '..'), {recursive: true})
    writeFileSync(absolute, content)
    return sha256Hex(readFileSync(absolute))
}

const planFor = (files) => ({
    schemaVersion: 'weavatrix.edit-plan.v1',
    operation: 'rename_symbol',
    files,
})

const renameEdit = {startLine: 1, startChar: 6, endLine: 1, endChar: 13, before: 'getUser', after: 'getCustomer', provenance: 'EXACT_LSP'}

test('dry run is pure and reports READY without writing', () => {
    const sha = writeRepoFile('src/a.js', 'const getUser = 1\n')
    const result = dryRunPlan(planFor([{path: 'src/a.js', sha256: sha, edits: [renameEdit]}]), {repoRoot})
    assert.equal(result.ok, true)
    assert.equal(readFileSync(join(repoRoot, 'src/a.js'), 'utf8'), 'const getUser = 1\n')
})

test('apply writes files and a rollback bundle restores them', () => {
    const sha = writeRepoFile('src/a.js', 'const getUser = 1\n')
    const applied = applyPlan(planFor([{path: 'src/a.js', sha256: sha, edits: [renameEdit]}]), {repoRoot})
    assert.equal(applied.status, 'APPLIED')
    assert.equal(applied.totalEdits, 1)
    assert.equal(readFileSync(join(repoRoot, 'src/a.js'), 'utf8'), 'const getCustomer = 1\n')

    const rolledBack = rollbackLastApply({repoRoot})
    assert.equal(rolledBack.status, 'ROLLED_BACK')
    assert.equal(readFileSync(join(repoRoot, 'src/a.js'), 'utf8'), 'const getUser = 1\n')
    // a bundle is consumed exactly once
    assert.equal(rollbackLastApply({repoRoot}).status, 'NO_BUNDLE')
})

test('hash drift after planning fails closed as STALE with nothing written', () => {
    const sha = writeRepoFile('src/a.js', 'const getUser = 1\n')
    writeFileSync(join(repoRoot, 'src/a.js'), 'const getUser = 2\n')
    const applied = applyPlan(planFor([{path: 'src/a.js', sha256: sha, edits: [renameEdit]}]), {repoRoot})
    assert.equal(applied.status, 'STALE')
    assert.equal(applied.files[0].status, 'STALE')
    assert.equal(readFileSync(join(repoRoot, 'src/a.js'), 'utf8'), 'const getUser = 2\n')
})

test('one stale file blocks the whole multi-file plan', () => {
    const shaA = writeRepoFile('a.js', 'const getUser = 1\n')
    const shaB = writeRepoFile('b.js', 'const getUser = 1\n')
    writeFileSync(join(repoRoot, 'b.js'), 'drifted\n')
    const applied = applyPlan(planFor([
        {path: 'a.js', sha256: shaA, edits: [renameEdit]},
        {path: 'b.js', sha256: shaB, edits: [renameEdit]},
    ]), {repoRoot})
    assert.equal(applied.status, 'STALE')
    assert.equal(readFileSync(join(repoRoot, 'a.js'), 'utf8'), 'const getUser = 1\n')
})

test('mid-apply write failure rolls back the already-written files', () => {
    const shaA = writeRepoFile('a.js', 'const getUser = 1\n')
    const shaB = writeRepoFile('b.js', 'const getUser = 1\n')
    let writes = 0
    const failingWrite = (path, buffer) => {
        writes += 1
        if (writes === 2) throw new Error('disk full (injected)')
        writeFileSync(path, buffer)
    }
    const applied = applyPlan(planFor([
        {path: 'a.js', sha256: shaA, edits: [renameEdit]},
        {path: 'b.js', sha256: shaB, edits: [renameEdit]},
    ]), {repoRoot, _writeFile: failingWrite})
    assert.equal(applied.status, 'ROLLED_BACK')
    assert.equal(applied.failedFile, 'b.js')
    assert.equal(readFileSync(join(repoRoot, 'a.js'), 'utf8'), 'const getUser = 1\n')
    assert.equal(readFileSync(join(repoRoot, 'b.js'), 'utf8'), 'const getUser = 1\n')
})

test('rollback refuses when the tree changed after apply (CONFLICT)', () => {
    const sha = writeRepoFile('a.js', 'const getUser = 1\n')
    const applied = applyPlan(planFor([{path: 'a.js', sha256: sha, edits: [renameEdit]}]), {repoRoot})
    assert.equal(applied.status, 'APPLIED')
    writeFileSync(join(repoRoot, 'a.js'), 'manual edit after apply\n')
    const rolledBack = rollbackLastApply({repoRoot})
    assert.equal(rolledBack.status, 'CONFLICT')
    assert.equal(readFileSync(join(repoRoot, 'a.js'), 'utf8'), 'manual edit after apply\n')
})

test('non-UTF-8 binary content is refused, never rewritten', () => {
    const buffer = Buffer.from([0x00, 0xff, 0xfe, 0x67, 0x65, 0x74])
    writeFileSync(join(repoRoot, 'bin.dat'), buffer)
    const result = dryRunPlan(planFor([{path: 'bin.dat', sha256: sha256Hex(buffer), edits: [renameEdit]}]), {repoRoot})
    assert.equal(result.ok, false)
    assert.equal(result.files[0].status, 'NOT_UTF8_TEXT')
})

test('plan paths cannot escape the repository', () => {
    assert.throws(
        () => dryRunPlan(planFor([{path: '../outside.js', sha256: 'a'.repeat(64), edits: [renameEdit]}]), {repoRoot}),
        (e) => e.code === 'INVALID_PATH',
    )
})

test('LEXICAL_EXACT provenance (bulk_replace plans) applies end-to-end', () => {
    const sha = writeRepoFile('src/a.js', 'callApi("v1")\n')
    const plan = {
        schemaVersion: 'weavatrix.edit-plan.v1',
        operation: 'bulk_replace',
        files: [{path: 'src/a.js', sha256: sha, edits: [{startLine: 1, startChar: 8, endLine: 1, endChar: 12, before: '"v1"', after: '"v2"', provenance: 'LEXICAL_EXACT'}]}],
    }
    const applied = applyPlan(plan, {repoRoot})
    assert.equal(applied.status, 'APPLIED')
    assert.equal(readFileSync(join(repoRoot, 'src/a.js'), 'utf8'), 'callApi("v2")\n')
})

test('missing file reports MISSING, not a crash', () => {
    const result = dryRunPlan(planFor([{path: 'nope.js', sha256: 'a'.repeat(64), edits: [renameEdit]}]), {repoRoot})
    assert.equal(result.ok, false)
    assert.equal(result.files[0].status, 'MISSING')
})
