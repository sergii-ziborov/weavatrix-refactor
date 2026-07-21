// End-to-end: boot the real MCP server (core + refactor extension) over stdio and verify
// the merged catalog exposes both edit tools next to the full core tool set.

import {test} from 'node:test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {dirname, join} from 'node:path'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

test('the live server merges core and edit tools under the refactor profile', async () => {
    const child = spawn(process.execPath, [join(packageRoot, 'bin', 'weavatrix-refactor-mcp.mjs'), packageRoot], {stdio: ['pipe', 'pipe', 'pipe']})
    let buffer = ''
    const responses = new Map()
    const waiters = new Map()
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
        buffer += chunk
        let newline
        while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline).trim()
            buffer = buffer.slice(newline + 1)
            if (!line) continue
            try {
                const message = JSON.parse(line)
                if (message.id != null) {
                    responses.set(message.id, message)
                    waiters.get(message.id)?.(message)
                }
            } catch {
                // stderr noise never reaches stdout; ignore non-JSON defensively
            }
        }
    })
    const request = (id, method, params) => {
        child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', id, method, params})}\n`)
        return new Promise((resolve, reject) => {
            if (responses.has(id)) return resolve(responses.get(id))
            const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 30000)
            waiters.set(id, (message) => {
                clearTimeout(timer)
                resolve(message)
            })
        })
    }
    try {
        const init = await request(1, 'initialize', {protocolVersion: '2024-11-05', capabilities: {}, clientInfo: {name: 'refactor-e2e', version: '0.0.0'}})
        assert.ok(init.result, `initialize failed: ${JSON.stringify(init.error)}`)
        const list = await request(2, 'tools/list', {})
        assert.ok(list.result, `tools/list failed: ${JSON.stringify(list.error)}`)
        const names = list.result.tools.map((tool) => tool.name)
        assert.ok(names.includes('apply_edit_plan'), 'apply_edit_plan missing from the merged catalog')
        assert.ok(names.includes('rollback_last_apply'), 'rollback_last_apply missing from the merged catalog')
        assert.ok(names.includes('graph_stats'), 'core tools missing from the merged catalog')
        assert.ok(names.length >= 36, `expected at least 36 tools (34 core + 2 edit), got ${names.length}`)
    } finally {
        child.kill()
    }
})
