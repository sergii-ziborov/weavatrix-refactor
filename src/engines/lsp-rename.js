// The rename-specific LSP composition lives HERE, in weavatrix-refactor, not in the core.
// The core exposes only a generic read-only LSP client (request/toUri/fromUri); this module
// issues textDocument/rename and normalizes the returned WorkspaceEdit to repo-relative
// files. Still purely a read: the language server computes the edits, nothing is applied
// (the core client refuses workspace/applyEdit); the rename plan producer turns this into a
// reviewable edit plan.

import {createTypeScriptLspClient} from 'weavatrix/analysis-kit'

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

// A core TypeScript LSP client wrapped with a rename() method, so the plan producers keep
// their existing client.rename(...) call shape.
export async function createRenameClient(options = {}) {
    const core = await createTypeScriptLspClient(options)
    return Object.freeze({
        ...core,
        rename: (relPath, position, newName, timeoutMs = options.timeoutMs) => lspRename(core, relPath, position, newName, timeoutMs),
    })
}
