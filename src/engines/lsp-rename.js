// The rename-specific LSP composition lives HERE, in weavatrix-refactor, not in the core.
// The core exposes only a generic read-only LSP client (request/toUri/fromUri); this module
// issues textDocument/rename and normalizes the returned WorkspaceEdit to repo-relative
// files. Still purely a read: the language server computes the edits, nothing is applied
// (the core client refuses workspace/applyEdit); the rename plan producer turns this into a
// reviewable edit plan.

import {resolve} from 'node:path'
import {createTypeScriptLspClient} from 'weavatrix-js/analysis-kit'

// One language server per repository, kept alive between calls. Spawning and shutting tsserver
// down was 48% of every rename's wall time and it was paid again on every single call, while
// the graph work costs ~0 ms. Correctness rule for reuse: every document opened for a rename is
// closed again when the client is released, so a pooled server can never answer from stale
// document text. A server that is still busy is never shared — that caller gets its own.
const POOL_IDLE_MS = 60_000
const clients = new Map()

const poolKey = (repoRoot) => resolve(String(repoRoot))

async function dispose(entry) {
    clearTimeout(entry.timer)
    try { await entry.client.close() } catch { entry.client.kill?.() }
}

async function evict(key) {
    const entry = clients.get(key)
    if (!entry) return
    clients.delete(key)
    await dispose(entry)
}

// Callers that own a process lifecycle (the MCP host, tests) end the pool explicitly.
export async function shutdownRenameClients() {
    await Promise.all([...clients.keys()].map((key) => evict(key)))
}

// A pooled server outlives the call that created it, so a hard exit must still reap it.
process.once('exit', () => {
    for (const entry of clients.values()) {
        clearTimeout(entry.timer)
        try { entry.client.kill?.() } catch { /* the process is already going away */ }
    }
    clients.clear()
})

export async function lspRename(client, relPath, position, newName, timeoutMs) {
    const normalized = client.toUri(relPath)
    const result = await client.request('textDocument/rename', {textDocument: {uri: normalized.uri}, position, newName}, {timeoutMs})
    const files = []
    const outsideRepository = []
    let resourceOperations = 0
    const collect = (uri, edits) => {
        let file
        try {
            file = client.fromUri(uri).file
        } catch (error) {
            if (error instanceof RangeError) { outsideRepository.push(String(uri)); return }
            throw error
        }
        files.push({file, edits: (edits || []).map((edit) => ({range: edit.range, newText: String(edit.newText ?? '')}))})
    }
    if (result && typeof result === 'object' && result.changes && typeof result.changes === 'object') {
        for (const [uri, edits] of Object.entries(result.changes)) collect(uri, edits)
    }
    if (result && Array.isArray(result.documentChanges)) {
        for (const change of result.documentChanges) {
            if (!change || typeof change !== 'object') continue
            if (typeof change.kind === 'string') { resourceOperations += 1; continue }
            collect(change.textDocument?.uri, change.edits)
        }
    }
    return {files, outsideRepository, resourceOperations}
}

// Wraps one core client in the rename() shape the plan producers already call, and turns
// close() into "release back to the pool" for pooled clients. kill() stays a real kill.
function renameFacade(core, {onRelease = null, onKill = null, timeoutMs} = {}) {
    const opened = new Set()
    return Object.freeze({
        ...core,
        openDocument: async (relPath, text, languageId) => {
            opened.add(relPath)
            return core.openDocument(relPath, text, languageId)
        },
        rename: (relPath, position, newName, requestTimeoutMs = timeoutMs) => lspRename(core, relPath, position, newName, requestTimeoutMs),
        close: async (shutdownTimeoutMs = timeoutMs) => {
            if (!onRelease) return core.close(shutdownTimeoutMs)
            // Drop this call's documents before anyone else can reuse the server.
            for (const relPath of opened) {
                try { await core.closeDocument(relPath) } catch { /* the server is going away anyway */ }
            }
            opened.clear()
            return onRelease()
        },
        kill: () => {
            opened.clear()
            if (onKill) return onKill()
            return core.kill()
        },
    })
}

// A core TypeScript LSP client wrapped with a rename() method, so the plan producers keep
// their existing client.rename(...) call shape. Reuses a pooled server when one is idle.
export async function createRenameClient(options = {}) {
    if (!options.repoRoot) return renameFacade(await createTypeScriptLspClient(options), {timeoutMs: options.timeoutMs})
    const key = poolKey(options.repoRoot)
    let entry = clients.get(key)
    if (entry?.busy) {
        // Concurrent rename on the same repository: never share document state, spawn a private
        // server for this caller and let it shut down normally.
        return renameFacade(await createTypeScriptLspClient(options), {timeoutMs: options.timeoutMs})
    }
    if (!entry) {
        entry = {client: await createTypeScriptLspClient(options), busy: false, timer: null}
        clients.set(key, entry)
    }
    clearTimeout(entry.timer)
    entry.busy = true
    return renameFacade(entry.client, {
        timeoutMs: options.timeoutMs,
        onRelease: () => {
            entry.busy = false
            clearTimeout(entry.timer)
            entry.timer = setTimeout(() => { void evict(key) }, POOL_IDLE_MS)
            entry.timer.unref?.()
        },
        // A killed server must leave the pool, or every later rename inherits a dead process.
        onKill: () => {
            clients.delete(key)
            clearTimeout(entry.timer)
            entry.busy = false
            return entry.client.kill()
        },
    })
}
