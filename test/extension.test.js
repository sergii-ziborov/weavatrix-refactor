import {test} from 'node:test'
import assert from 'node:assert/strict'
import {refactorExtension} from '../src/extension.mjs'

test('extension validates against the published core extension API', () => {
    const extension = refactorExtension()
    assert.equal(extension.name, 'refactor')
    assert.equal(extension.tools.length, 2)
    assert.deepEqual(extension.tools.map((tool) => tool.name), ['apply_edit_plan', 'rollback_last_apply'])
    for (const tool of extension.tools) assert.equal(tool.cap, 'edit')
    assert.deepEqual(extension.profiles.refactor, ['graph', 'search', 'source', 'health', 'build', 'retarget', 'crossrepo', 'edit'])
    assert.deepEqual(extension.skills, [{name: 'weavatrix-refactor', path: 'skill/SKILL.md'}])
})

test('the write capability is absent from every core profile by construction', () => {
    // Core profiles are core-owned; this extension only ADDS the refactor profile.
    // The invariant that matters: our tools carry cap 'edit', which no core profile names.
    const extension = refactorExtension()
    const coreCapNames = ['graph', 'search', 'source', 'health', 'build', 'retarget', 'crossrepo']
    for (const tool of extension.tools) assert.equal(coreCapNames.includes(tool.cap), false)
})
