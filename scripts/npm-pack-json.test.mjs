import assert from 'node:assert/strict'
import test from 'node:test'
import {packRecord, packRecords} from './npm-pack-json.mjs'

const packageRecord = {
    filename: 'weavatrix-refactor-1.0.0.tgz',
    files: [{path: 'README.md'}],
}

test('normalizes npm array output', () => {
    assert.deepEqual(packRecord([packageRecord]), packageRecord)
})

test('normalizes keyed npm output', () => {
    assert.deepEqual(packRecord({packages: {'weavatrix-refactor@1.0.0': packageRecord}}), packageRecord)
})

test('ignores unrelated metadata while finding package records', () => {
    assert.deepEqual(packRecords({notice: 'npm', result: [packageRecord]}), [packageRecord])
})
