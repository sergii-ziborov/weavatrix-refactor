import {test} from 'node:test'
import assert from 'node:assert/strict'
import {applyEditsToContent, EditApplyError, offsetAt} from '../src/edit-engine.mjs'

const edit = (startLine, startChar, endLine, endChar, before, after) => ({startLine, startChar, endLine, endChar, before, after, provenance: 'EXACT_LSP'})

test('offsetAt maps 1-based line / 0-based char over LF content', () => {
    const content = 'alpha\nbeta\ngamma'
    assert.equal(offsetAt(content, 1, 0), 0)
    assert.equal(offsetAt(content, 2, 0), 6)
    assert.equal(offsetAt(content, 3, 5), 16)
})

test('offsetAt fails closed past the file end', () => {
    assert.throws(() => offsetAt('one\ntwo', 4, 0), (e) => e instanceof EditApplyError && e.code === 'POSITION_OUT_OF_RANGE')
    assert.throws(() => offsetAt('one', 1, 99), (e) => e.code === 'POSITION_OUT_OF_RANGE')
})

test('applies a single rename edit', () => {
    const next = applyEditsToContent('const getUser = 1\n', [edit(1, 6, 1, 13, 'getUser', 'getCustomer')])
    assert.equal(next, 'const getCustomer = 1\n')
})

test('multiple edits on one line apply bottom-up without shifting ranges', () => {
    const content = 'getUser(getUser)\n'
    const next = applyEditsToContent(content, [
        edit(1, 0, 1, 7, 'getUser', 'getCustomer'),
        edit(1, 8, 1, 15, 'getUser', 'getCustomer'),
    ])
    assert.equal(next, 'getCustomer(getCustomer)\n')
})

test('CRLF line endings are preserved and ranges stay exact', () => {
    const content = 'first\r\nrename me\r\nlast\r\n'
    const next = applyEditsToContent(content, [edit(2, 0, 2, 6, 'rename', 'renamed')])
    assert.equal(next, 'first\r\nrenamed me\r\nlast\r\n')
})

test('UTF-16 surrogate pairs count as two units, matching JS indexing', () => {
    const content = 'const x = "\u{1F600}"; getUser()\n'
    // the emoji occupies 2 UTF-16 units, so getUser starts at 16, not 15
    const next = applyEditsToContent(content, [edit(1, 16, 1, 23, 'getUser', 'getCustomer')])
    assert.equal(next, 'const x = "\u{1F600}"; getCustomer()\n')
})

test('before-text mismatch fails the whole file closed', () => {
    assert.throws(
        () => applyEditsToContent('const getUsr = 1\n', [edit(1, 6, 1, 13, 'getUser', 'getCustomer')]),
        (e) => e instanceof EditApplyError && e.code === 'BEFORE_MISMATCH',
    )
})

test('overlapping edits are rejected', () => {
    const content = 'abcdefgh\n'
    assert.throws(
        () => applyEditsToContent(content, [edit(1, 0, 1, 4, 'abcd', 'x'), edit(1, 2, 1, 6, 'cdef', 'y')]),
        (e) => e.code === 'OVERLAPPING_EDITS',
    )
})

test('multi-line deletion spans the terminator via the next-line representation', () => {
    const content = 'keep\ndelete me\nkeep too\n'
    const next = applyEditsToContent(content, [edit(2, 0, 3, 0, 'delete me\n', '')])
    assert.equal(next, 'keep\nkeep too\n')
})
