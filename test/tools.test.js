import {test, beforeEach} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {refactorTools} from '../src/tools.mjs'
import {sha256Hex} from '../src/refactor-home.mjs'

let repoRoot, ctx
const [applyEditPlan, rollbackLast] = refactorTools()

beforeEach(() => {
    process.env.WEAVATRIX_REFACTOR_HOME = mkdtempSync(join(tmpdir(), 'wvx-refactor-home-'))
    delete process.env.WEAVATRIX_ALLOW_SOURCE_EDITS
    repoRoot = mkdtempSync(join(tmpdir(), 'wvx-refactor-repo-'))
    ctx = {repoRoot, graphPath: join(repoRoot, 'graph.json')}
})

const fixturePlan = () => {
    const content = 'const getUser = 1\n'
    writeFileSync(join(repoRoot, 'a.js'), content)
    return {
        schemaVersion: 'weavatrix.edit-plan.v1',
        operation: 'rename_symbol',
        files: [{
            path: 'a.js',
            sha256: sha256Hex(Buffer.from(content)),
            edits: [{startLine: 1, startChar: 6, endLine: 1, endChar: 13, before: 'getUser', after: 'getCustomer', provenance: 'EXACT_LSP'}],
        }],
        uncertainReferences: [{path: 'factory.js', line: 3, kind: 'DYNAMIC_PROPERTY_ACCESS'}],
    }
}

test('tools register with cap edit only', () => {
    for (const tool of refactorTools()) assert.equal(tool.cap, 'edit')
    assert.deepEqual(refactorTools().map((tool) => tool.name), ['apply_edit_plan', 'rollback_last_apply'])
})

test('preview works without the write gate and issues a single-use token', async () => {
    const result = await applyEditPlan.run(null, {plan: fixturePlan()}, ctx)
    assert.equal(result.result.status, 'PREVIEW_OK')
    assert.match(result.result.confirmToken, /^[0-9a-f]{48}$/)
    assert.equal(result.result.uncertainReferences, 1)
    // preview never writes
    assert.equal(readFileSync(join(repoRoot, 'a.js'), 'utf8'), 'const getUser = 1\n')
})

test('apply without the env gate is WRITE_GATE_CLOSED', async () => {
    const plan = fixturePlan()
    const preview = await applyEditPlan.run(null, {plan}, ctx)
    const result = await applyEditPlan.run(null, {plan, mode: 'apply', confirm_token: preview.result.confirmToken}, ctx)
    assert.equal(result.result.status, 'WRITE_GATE_CLOSED')
    assert.equal(readFileSync(join(repoRoot, 'a.js'), 'utf8'), 'const getUser = 1\n')
})

test('preview -> apply happy path writes and reports the honest remainder', async () => {
    process.env.WEAVATRIX_ALLOW_SOURCE_EDITS = '1'
    const plan = fixturePlan()
    const preview = await applyEditPlan.run(null, {plan}, ctx)
    const result = await applyEditPlan.run(null, {plan, mode: 'apply', confirm_token: preview.result.confirmToken}, ctx)
    assert.equal(result.result.status, 'APPLIED')
    assert.equal(result.result.uncertainReferences, 1)
    assert.equal(readFileSync(join(repoRoot, 'a.js'), 'utf8'), 'const getCustomer = 1\n')
    assert.match(result.text, /verified_change/)
})

test('a confirm token is single-use', async () => {
    process.env.WEAVATRIX_ALLOW_SOURCE_EDITS = '1'
    const plan = fixturePlan()
    const preview = await applyEditPlan.run(null, {plan}, ctx)
    const token = preview.result.confirmToken
    await applyEditPlan.run(null, {plan, mode: 'apply', confirm_token: token}, ctx)
    // restore the file so only the token could block the second apply
    writeFileSync(join(repoRoot, 'a.js'), 'const getUser = 1\n')
    const second = await applyEditPlan.run(null, {plan, mode: 'apply', confirm_token: token}, ctx)
    assert.equal(second.result.status, 'TOKEN_UNKNOWN')
})

test('a token from a different plan is rejected before anything is written', async () => {
    process.env.WEAVATRIX_ALLOW_SOURCE_EDITS = '1'
    const plan = fixturePlan()
    const preview = await applyEditPlan.run(null, {plan}, ctx)
    const altered = {...plan, operation: 'move_symbol'}
    const result = await applyEditPlan.run(null, {plan: altered, mode: 'apply', confirm_token: preview.result.confirmToken}, ctx)
    assert.equal(result.result.status, 'TOKEN_PLAN_MISMATCH')
    assert.equal(readFileSync(join(repoRoot, 'a.js'), 'utf8'), 'const getUser = 1\n')
})

test('stale tree between preview and apply fails closed', async () => {
    process.env.WEAVATRIX_ALLOW_SOURCE_EDITS = '1'
    const plan = fixturePlan()
    const preview = await applyEditPlan.run(null, {plan}, ctx)
    writeFileSync(join(repoRoot, 'a.js'), 'const getUser = 2\n')
    const result = await applyEditPlan.run(null, {plan, mode: 'apply', confirm_token: preview.result.confirmToken}, ctx)
    assert.equal(result.result.status, 'STALE')
    assert.equal(readFileSync(join(repoRoot, 'a.js'), 'utf8'), 'const getUser = 2\n')
})

test('an invalid plan is INVALID_PLAN, not a crash', async () => {
    const result = await applyEditPlan.run(null, {plan: {schemaVersion: 'nope'}}, ctx)
    assert.equal(result.result.status, 'INVALID_PLAN')
    assert.equal(result.result.code, 'SCHEMA_MISMATCH')
})

test('an INFERRED edit is rejected as unproven', async () => {
    const plan = fixturePlan()
    plan.files[0].edits[0].provenance = 'INFERRED'
    const result = await applyEditPlan.run(null, {plan}, ctx)
    assert.equal(result.result.status, 'INVALID_PLAN')
    assert.equal(result.result.code, 'UNPROVEN_EDIT')
})

test('rollback tool respects the write gate and full cycle restores', async () => {
    const plan = fixturePlan()
    const gateClosed = await rollbackLast.run(null, {}, ctx)
    assert.equal(gateClosed.result.status, 'WRITE_GATE_CLOSED')

    process.env.WEAVATRIX_ALLOW_SOURCE_EDITS = '1'
    const preview = await applyEditPlan.run(null, {plan}, ctx)
    await applyEditPlan.run(null, {plan, mode: 'apply', confirm_token: preview.result.confirmToken}, ctx)
    const rolledBack = await rollbackLast.run(null, {}, ctx)
    assert.equal(rolledBack.result.status, 'ROLLED_BACK')
    assert.equal(readFileSync(join(repoRoot, 'a.js'), 'utf8'), 'const getUser = 1\n')
})
