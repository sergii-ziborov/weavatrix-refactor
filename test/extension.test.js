import {test} from 'node:test'
import assert from 'node:assert/strict'
import {refactorExtension} from '../src/extension.mjs'

const APPLY_TOOLS = ['apply_edit_plan', 'rollback_last_apply']
const PLAN_TOOLS = ['rename_symbol', 'rename_related_symbols', 'move_file', 'move_symbol', 'delete_readiness', 'change_signature', 'edit_symbol', 'bulk_replace', 'organize_imports']

test('extension validates against the published core extension API', () => {
    const extension = refactorExtension()
    assert.equal(extension.name, 'refactor')
    const names = extension.tools.map((tool) => tool.name)
    for (const name of [...APPLY_TOOLS, ...PLAN_TOOLS]) assert.ok(names.includes(name), `missing tool ${name}`)
    assert.deepEqual(extension.profiles.refactor, ['graph', 'search', 'source', 'health', 'build', 'retarget', 'crossrepo', 'edit'])
    assert.deepEqual(extension.skills, [{name: 'weavatrix-refactor', path: 'skill/SKILL.md'}])
})

test('only the apply tools carry the write capability; plan producers are read-only', () => {
    const extension = refactorExtension()
    const byName = new Map(extension.tools.map((tool) => [tool.name, tool]))
    // apply/rollback write -> cap 'edit'; every plan producer is read-only -> cap 'graph'
    for (const name of APPLY_TOOLS) assert.equal(byName.get(name).cap, 'edit', `${name} must be cap edit`)
    for (const name of PLAN_TOOLS) assert.equal(byName.get(name).cap, 'graph', `${name} must be read-only cap graph`)
})
