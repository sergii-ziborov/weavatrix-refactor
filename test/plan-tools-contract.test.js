// The plan tools' refusal contract. Every engine states its preconditions by throwing an
// Error that names its internal parameters; none of that is an agent contract. A bad or
// missing argument has to surface as a typed status, exactly like every other refusal here.

import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {planTools} from '../src/plan-tools.mjs'

const toolNamed = (name) => planTools().find((tool) => tool.name === name)

const fixtureRepo = (files) => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'wvx-plan-contract-'))
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(join(repoRoot, path, '..'), {recursive: true})
        writeFileSync(join(repoRoot, path), content)
    }
    return repoRoot
}

const graphFor = (...files) => ({nodes: files.map((file) => ({id: file, source_file: file})), links: [], graphRevision: 'test'})

// name -> an argument object that is missing or mistypes at least one required field
const BAD_ARGS = {
    rename_symbol: [{}, {symbol: 'a.js#x@1'}, {symbol: '  ', new_name: 'y'}],
    rename_related_symbols: [{}, {renames: []}, {renames: 'a.js#x@1'}],
    move_file: [{}, {from: 'a.js'}, {from: 'a.js', to: ''}],
    move_symbol: [{}, {symbol: 'a.js#x@1'}, {target_file: 'b.js'}],
    delete_readiness: [{}, {target: 'a.js'}, {symbol: ''}],
    change_signature: [{}, {symbol: 'a.js#x@1'}, {symbol: 'a.js#x@1', operation: 'add_parameter'}],
    edit_symbol: [{}, {symbol: 'a.js#x@1'}, {symbol: 'a.js#x@1', operation: 'replace_symbol_body'}],
    organize_imports: [{}, {path: 'a.js'}, {file: '   '}],
}

test('every plan tool refuses bad arguments with a typed status, never a thrown Error', async () => {
    const repoRoot = fixtureRepo({'a.js': 'const x = 1\n'})
    const ctx = {repoRoot, graphPath: join(repoRoot, 'graph.json')}
    for (const [name, cases] of Object.entries(BAD_ARGS)) {
        const tool = toolNamed(name)
        assert.ok(tool, `${name} is not registered`)
        for (const args of cases) {
            const result = await tool.run(graphFor('a.js'), args, ctx)
            assert.equal(result.result.status, 'INVALID_ARGS', `${name} with ${JSON.stringify(args)}`)
            assert.ok(Array.isArray(result.result.invalid) && result.result.invalid.length, `${name} must name the invalid arguments`)
            assert.doesNotMatch(result.text, /requires repoRoot|rawGraph|targetId|symbolId/, `${name} leaks internal engine parameter names`)
        }
    }
})

test('a plan tool without an active repository is NO_REPOSITORY, not a crash', async () => {
    for (const name of Object.keys(BAD_ARGS)) {
        const result = await toolNamed(name).run(graphFor('a.js'), {symbol: 'a.js#x@1', new_name: 'y'}, {})
        assert.equal(result.result.status, 'NO_REPOSITORY', name)
    }
})

test('a valid argument set still reaches the engine and is not swallowed by the gate', async () => {
    const repoRoot = fixtureRepo({'a.js': 'const x = 1\n'})
    const result = await toolNamed('delete_readiness').run(
        graphFor('a.js'),
        {symbol: 'a.js#x@1'},
        {repoRoot, graphPath: join(repoRoot, 'graph.json')},
    )
    assert.notEqual(result.result.status, 'INVALID_ARGS')
    assert.notEqual(result.result.status, 'NO_REPOSITORY')
})

test('bulk_replace text mode reports the count and the files, not a bare PREVIEW', async () => {
    const repoRoot = fixtureRepo({
        'a.js': 'callApi("v1")\ncallApi("v1")\n',
        'b.js': 'const url = "v1"\n',
    })
    const result = await toolNamed('bulk_replace').run(
        graphFor('a.js', 'b.js'),
        {pattern: '"v1"', replacement: '"v2"'},
        {repoRoot, graphPath: join(repoRoot, 'graph.json')},
    )
    assert.equal(result.result.status, 'PREVIEW')
    assert.match(result.text, /3 occurrence\(s\) across 2 scanned file\(s\)/)
    assert.match(result.text, /- a\.js: 2/)
    assert.match(result.text, /- b\.js: 1/)
    assert.match(result.text, /next: /)
})

test('bulk_replace keeps its own typed pattern refusals instead of collapsing to INVALID_ARGS', async () => {
    const repoRoot = fixtureRepo({'a.js': 'const x = 1\n'})
    const ctx = {repoRoot, graphPath: join(repoRoot, 'graph.json')}
    const empty = await toolNamed('bulk_replace').run(graphFor('a.js'), {pattern: '', replacement: 'y'}, ctx)
    assert.equal(empty.result.status, 'INVALID_PATTERN')
    const badFlags = await toolNamed('bulk_replace').run(graphFor('a.js'), {pattern: 'x', replacement: 'y', flags: 'g'}, ctx)
    assert.equal(badFlags.result.status, 'INVALID_PATTERN')
})

test('move_symbol text mode carries the verdict instead of a bare EVALUATED', async () => {
    const repoRoot = fixtureRepo({'a.js': 'export function x() { return 1 }\n', 'b.js': 'export const y = 2\n'})
    const rawGraph = {
        nodes: [
            {id: 'a.js', source_file: 'a.js'},
            {id: 'b.js', source_file: 'b.js'},
            {id: 'a.js#x@1', label: 'x()', source_file: 'a.js', kind: 'function'},
        ],
        links: [],
        graphRevision: 'test',
    }
    const result = await toolNamed('move_symbol').run(rawGraph, {symbol: 'a.js#x@1', to_file: 'b.js'}, {repoRoot, graphPath: join(repoRoot, 'graph.json')})
    assert.equal(result.result.status, 'EVALUATED')
    assert.match(result.text, /verdict=/)
})
