// Regression tests for the adversarial-review findings: surrogate corruption, link
// escapes, .git bypasses, rollback wedging, concurrency, litter and size limits.

import {test, beforeEach} from 'node:test'
import assert from 'node:assert/strict'
import {chmodSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {applyEditsToContent} from '../src/edit-engine.mjs'
import {validatePlanPath, PlanValidationError} from '../src/edit-plan.mjs'
import {applyPlan, dryRunPlan} from '../src/apply-session.mjs'
import {rollbackLastApply} from '../src/rollback.mjs'
import {acquireRepoLock, sha256Hex} from '../src/refactor-home.mjs'
import {MAX_FILE_BYTES} from '../src/fs-io.mjs'

let repoRoot

beforeEach(() => {
    process.env.WEAVATRIX_REFACTOR_HOME = mkdtempSync(join(tmpdir(), 'wvx-refactor-home-'))
    repoRoot = mkdtempSync(join(tmpdir(), 'wvx-refactor-repo-'))
})

const planFor = (files) => ({schemaVersion: 'weavatrix.edit-plan.v1', operation: 'rename_symbol', files})
const writeRepoFile = (path, content) => {
    writeFileSync(join(repoRoot, path), content)
    return sha256Hex(readFileSync(join(repoRoot, path)))
}
const renameEdit = {startLine: 1, startChar: 6, endLine: 1, endChar: 13, before: 'getUser', after: 'getCustomer', provenance: 'EXACT_LSP'}

test('two inserts at one position preserve the plan array order', () => {
    const insert = (text) => ({startLine: 1, startChar: 4, endLine: 1, endChar: 4, before: '', after: text, provenance: 'EXACT_LSP'})
    const next = applyEditsToContent('abcd\n', [insert('1'), insert('2')])
    assert.equal(next, 'abcd12\n')
})

test('an after-text with a lone surrogate is refused, never written lossily', () => {
    const sha = writeRepoFile('a.js', 'const getUser = 1\n')
    const plan = planFor([{path: 'a.js', sha256: sha, edits: [{...renameEdit, after: '\ud800bad'}]}])
    const result = dryRunPlan(plan, {repoRoot})
    assert.equal(result.ok, false)
    assert.equal(result.files[0].status, 'EDIT_PRODUCES_INVALID_TEXT')
})

test('an edit that splits a surrogate pair is refused', () => {
    const content = 'x = "\u{1F600}"\n'
    const sha = writeRepoFile('emoji.js', content)
    // range [5,6] covers only the high surrogate of the emoji
    const plan = planFor([{path: 'emoji.js', sha256: sha, edits: [{startLine: 1, startChar: 5, endLine: 1, endChar: 6, before: '\ud83d', after: 'Z', provenance: 'EXACT_LSP'}]}])
    const result = dryRunPlan(plan, {repoRoot})
    assert.equal(result.ok, false)
    assert.equal(result.files[0].status, 'EDIT_PRODUCES_INVALID_TEXT')
    assert.equal(readFileSync(join(repoRoot, 'emoji.js'), 'utf8'), content)
})

test('NTFS streams, .GIT casing and Windows trailing-dot .git bypasses are rejected', () => {
    for (const path of ['a.js:stream', '.GIT/config', 'src/.git./hooks.js', '.git ./x', 'C:/x.js']) {
        assert.throws(() => validatePlanPath(path), (e) => e instanceof PlanValidationError && e.code === 'INVALID_PATH', path)
    }
})

test('a link inside the repo pointing outside is caught by realpath containment', () => {
    const outside = mkdtempSync(join(tmpdir(), 'wvx-outside-'))
    writeFileSync(join(outside, 'victim.js'), 'const getUser = 1\n')
    try {
        symlinkSync(outside, join(repoRoot, 'link'), 'junction')
    } catch {
        return // symlink creation not permitted in this environment; nothing to assert
    }
    const sha = sha256Hex(readFileSync(join(outside, 'victim.js')))
    const result = dryRunPlan(planFor([{path: 'link/victim.js', sha256: sha, edits: [renameEdit]}]), {repoRoot})
    assert.equal(result.ok, false)
    assert.equal(result.files[0].status, 'PATH_ESCAPES_REPO')
    assert.equal(readFileSync(join(outside, 'victim.js'), 'utf8'), 'const getUser = 1\n')
})

test('a file over the size limit gets a clean FILE_TOO_LARGE status, not a crash', () => {
    writeFileSync(join(repoRoot, 'big.js'), Buffer.alloc(MAX_FILE_BYTES + 1, 0x61))
    const result = dryRunPlan(planFor([{path: 'big.js', sha256: 'a'.repeat(64), edits: [renameEdit]}]), {repoRoot})
    assert.equal(result.ok, false)
    assert.equal(result.files[0].status, 'FILE_TOO_LARGE')
})

test('a held repository lock makes apply and rollback report REPO_BUSY', () => {
    const sha = writeRepoFile('a.js', 'const getUser = 1\n')
    const lock = acquireRepoLock(repoRoot)
    assert.ok(lock)
    const applied = applyPlan(planFor([{path: 'a.js', sha256: sha, edits: [renameEdit]}]), {repoRoot})
    assert.equal(applied.status, 'REPO_BUSY')
    assert.equal(rollbackLastApply({repoRoot}).status, 'REPO_BUSY')
    lock.release()
    assert.equal(applyPlan(planFor([{path: 'a.js', sha256: sha, edits: [renameEdit]}]), {repoRoot}).status, 'APPLIED')
})

test('a failed restore is ROLLBACK_INCOMPLETE and a retry converges instead of wedging', () => {
    const shaA = writeRepoFile('a.js', 'const getUser = 1\n')
    const shaB = writeRepoFile('b.js', 'const getUser = 1\n')
    const applied = applyPlan(planFor([
        {path: 'a.js', sha256: shaA, edits: [renameEdit]},
        {path: 'b.js', sha256: shaB, edits: [renameEdit]},
    ]), {repoRoot})
    assert.equal(applied.status, 'APPLIED')

    chmodSync(join(repoRoot, 'b.js'), 0o444)
    let first
    try {
        first = rollbackLastApply({repoRoot})
    } finally {
        chmodSync(join(repoRoot, 'b.js'), 0o644)
    }
    if (first.status === 'ROLLBACK_INCOMPLETE') {
        // a.js restored, b.js blocked; the bundle survived, so the retry finishes the job
        assert.deepEqual(first.restored, ['a.js'])
        const second = rollbackLastApply({repoRoot})
        assert.equal(second.status, 'ROLLED_BACK')
        assert.equal(second.restored, 1)
        assert.equal(second.alreadyOriginal, 1)
    } else {
        // platforms where read-only does not block rename: the single pass must fully restore
        assert.equal(first.status, 'ROLLED_BACK')
    }
    assert.equal(readFileSync(join(repoRoot, 'a.js'), 'utf8'), 'const getUser = 1\n')
    assert.equal(readFileSync(join(repoRoot, 'b.js'), 'utf8'), 'const getUser = 1\n')
})

test('after a mid-apply rollback, running rollback again is a clean no-op, not a CONFLICT', () => {
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
    const again = rollbackLastApply({repoRoot})
    assert.equal(again.status, 'ROLLED_BACK')
    assert.equal(again.restored, 0)
    assert.equal(again.alreadyOriginal, 2)
})

test('no tmp litter is left behind after an injected write failure', () => {
    const sha = writeRepoFile('a.js', 'const getUser = 1\n')
    const failingWrite = () => { throw new Error('boom (injected)') }
    applyPlan(planFor([{path: 'a.js', sha256: sha, edits: [renameEdit]}]), {repoRoot, _writeFile: failingWrite})
    const leftovers = readdirSync(repoRoot).filter((name) => name.includes('weavatrix-tmp'))
    assert.deepEqual(leftovers, [])
})
