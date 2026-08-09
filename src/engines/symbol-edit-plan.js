// Symbol-anchored edit-plan producers: replace_symbol_body, insert_before_symbol,
// insert_after_symbol. Pure reads (ADR 0002): each emits a weavatrix.edit-plan.v1
// envelope for the separate weavatrix-refactor applier — never touches the file itself.
// Unlike rename these need no language server: the parser-owned source_range anchors the
// edit, so they work for every indexed language. Provenance is EXTRACTED accordingly.
// For JS/TS the resulting file is additionally parse-checked before a plan is issued.

import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {sha256Hex} from './engine-kit.js'

export const SYMBOL_EDIT_OPERATIONS = ['replace_symbol_body', 'insert_before_symbol', 'insert_after_symbol']

const JS_TS_FILE_RE = /\.(?:[cm]?[jt]sx?)$/i
const MAX_CONTENT_BYTES = 1024 * 1024


// Absolute string offset for a 0-based LSP position; fails closed outside the content.
// Non-integer positions and characters that spill past the line terminator are rejected —
// both are staleness/corruption signals, never coordinates to guess around.
function offsetAtLsp(content, line, character) {
    if (!Number.isInteger(line) || line < 0 || !Number.isInteger(character) || character < 0) {
        throw new Error(`position ${line}:${character} is not a valid non-negative integer pair`)
    }
    let lineStart = 0
    for (let current = 0; current < line; current += 1) {
        const nextBreak = content.indexOf('\n', lineStart)
        if (nextBreak === -1) throw new Error(`position line ${line} exceeds file line count`)
        lineStart = nextBreak + 1
    }
    const lineBreak = content.indexOf('\n', lineStart)
    const lineEnd = lineBreak === -1 ? content.length : lineBreak
    if (character > lineEnd - lineStart) throw new Error(`character ${character} exceeds line ${line} length`)
    return lineStart + character
}

// Parse gate over the bundled TypeScript compiler, honestly labeled: a clean parse of a
// real TS file is 'PARSES'; a clean parse of a JS-family file is only 'PARSES_PERMISSIVE'
// (the TS parser accepts TS-only syntax in .js and ESM in .cjs, so it cannot prove Node
// would load the file). A parse FAILURE is decisive for both. If the diagnostics surface
// ever disappears, the check reports NOT_VALIDATED instead of guessing.
async function syntaxCheck(file, nextContent) {
    if (!JS_TS_FILE_RE.test(file)) return {status: 'NOT_APPLICABLE_FOR_LANGUAGE'}
    try {
        const ts = (await import('typescript')).default
        const sourceFile = ts.createSourceFile(file, nextContent, ts.ScriptTarget.Latest, false)
        const diagnostics = Array.isArray(sourceFile?.parseDiagnostics) ? sourceFile.parseDiagnostics : null
        if (!diagnostics) return {status: 'NOT_VALIDATED'}
        if (!diagnostics.length) return {status: /\.[cm]?tsx?$/i.test(file) ? 'PARSES' : 'PARSES_PERMISSIVE'}
        const first = diagnostics[0]
        const message = typeof first?.messageText === 'string' ? first.messageText : first?.messageText?.messageText || 'syntax error'
        return {status: 'SYNTAX_ERROR', message}
    } catch {
        return {status: 'NOT_VALIDATED'}
    }
}

const planEnvelope = ({operation, rawGraph, file, sha256, edits, warnings, syntax}) => ({
    schemaVersion: 'weavatrix.edit-plan.v1',
    operation,
    createdAt: new Date().toISOString(),
    graphRevision: rawGraph.graphRevision || null,
    completeness: 'COMPLETE',
    files: [{path: file, sha256, edits}],
    uncertainReferences: [],
    notModified: [],
    warnings,
    ...(syntax ? {syntaxCheck: syntax.status} : {}),
    followUp: 'apply with weavatrix-refactor apply_edit_plan (preview -> confirm) or your editor, then run verified_change phase=verify',
})

// Builds the plan for one symbol-anchored edit. Returns a status object; 'PLANNED'
// carries the envelope. Expected conditions are statuses, never exceptions.
function prepareSymbolEdit({repoRoot, rawGraph, targetId, operation, content}) {
    if (!repoRoot || !rawGraph || !targetId) throw new Error('symbol edit plan requires repoRoot, rawGraph, and targetId')
    if (!SYMBOL_EDIT_OPERATIONS.includes(operation)) {
        return {result: {status: 'INVALID_OPERATION', reason: `operation must be one of: ${SYMBOL_EDIT_OPERATIONS.join(', ')}`}}
    }
    if (typeof content !== 'string' || !content.length) return {result: {status: 'INVALID_CONTENT', reason: 'content must be a non-empty string'}}
    if (Buffer.byteLength(content) > MAX_CONTENT_BYTES) return {result: {status: 'INVALID_CONTENT', reason: `content exceeds the ${MAX_CONTENT_BYTES / 1024} KB limit`}}
    const id = String(targetId)
    const node = (rawGraph.nodes || []).find((candidate) => String(candidate?.id || '') === id)
    if (!node) return {result: {status: 'NOT_FOUND', reason: 'the selected symbol is not present in the active graph'}}
    const range = node.source_range
    if (!range?.start || !range?.end) {
        return {result: {status: 'NOT_SUPPORTED', reason: 'the graph recorded no source range for this symbol; rebuild the graph or edit manually'}}
    }
    const file = String(node.source_file || id.split('#')[0] || '')
    let buffer
    try {
        buffer = readFileSync(resolve(repoRoot, file))
    } catch {
        return {result: {status: 'SOURCE_UNAVAILABLE', reason: `${file}: file does not exist or is unreadable`}}
    }
    const original = buffer.toString('utf8')
    if (!Buffer.from(original, 'utf8').equals(buffer)) {
        return {result: {status: 'SOURCE_UNAVAILABLE', reason: `${file}: not valid UTF-8 text`}}
    }
    let startOffset
    let endOffset
    try {
        startOffset = offsetAtLsp(original, Number(range.start.line), Number(range.start.character))
        endOffset = offsetAtLsp(original, Number(range.end.line), Number(range.end.character))
    } catch (error) {
        return {result: {status: 'STALE_GRAPH', reason: `the symbol range no longer matches the file: ${error.message}`}}
    }
    if (endOffset < startOffset) return {result: {status: 'STALE_GRAPH', reason: 'the symbol range is inverted; rebuild the graph'}}
    if (operation === 'replace_symbol_body' && endOffset === startOffset) {
        return {result: {status: 'NOT_SUPPORTED', reason: 'the graph recorded a zero-width range for this symbol; replace_symbol_body cannot prove what it would replace — edit manually'}}
    }
    return {id, node, range, file, buffer, original, startOffset, endOffset}
}

function createSymbolEdit({operation, content, original, range, startOffset, endOffset}) {
    const eol = original.includes('\r\n') ? '\r\n' : '\n'
    if (operation === 'replace_symbol_body') {
        const before = original.slice(startOffset, endOffset)
        if (before === content) return {result: {status: 'NO_CHANGE', reason: 'the replacement is identical to the current definition'}}
        return {edit: {
            startLine: Number(range.start.line) + 1,
            startChar: Number(range.start.character),
            endLine: Number(range.end.line) + 1,
            endChar: Number(range.end.character),
            before,
            after: content,
            provenance: 'EXTRACTED',
        }}
    }
    const insertion = content.endsWith('\n') ? content : `${content}${eol}`
    if (operation === 'insert_before_symbol') {
        return {edit: {
            startLine: Number(range.start.line) + 1,
            startChar: 0,
            endLine: Number(range.start.line) + 1,
            endChar: 0,
            before: '',
            after: insertion,
            provenance: 'EXTRACTED',
        }}
    }
    const nextLineBreak = original.indexOf('\n', endOffset)
    if (nextLineBreak !== -1) {
        return {edit: {
            startLine: Number(range.end.line) + 2,
            startChar: 0,
            endLine: Number(range.end.line) + 2,
            endChar: 0,
            before: '',
            after: insertion,
            provenance: 'EXTRACTED',
        }}
    }
    const lastLine = original.split('\n').length
    const lastLineStart = original.lastIndexOf('\n') + 1
    return {edit: {
        startLine: lastLine,
        startChar: original.length - lastLineStart,
        endLine: lastLine,
        endChar: original.length - lastLineStart,
        before: '',
        after: `${eol}${content}`,
        provenance: 'EXTRACTED',
    }}
}

export async function buildSymbolEditPlan({repoRoot, rawGraph, targetId, operation, content} = {}) {
    const prepared = prepareSymbolEdit({repoRoot, rawGraph, targetId, operation, content})
    if (prepared.result) return prepared.result
    const {id, node, range, file, buffer, original, startOffset, endOffset} = prepared
    const built = createSymbolEdit({operation, content, original, range, startOffset, endOffset})
    if (built.result) return built.result
    const {edit} = built

    const nextContent = original.slice(0, offsetAtLsp(original, edit.startLine - 1, edit.startChar))
        + edit.after
        + original.slice(offsetAtLsp(original, edit.endLine - 1, edit.endChar))
    const syntax = await syntaxCheck(file, nextContent)
    if (syntax.status === 'SYNTAX_ERROR') {
        return {status: 'SYNTAX_ERROR', reason: `applying this edit would produce a file that does not parse: ${syntax.message}`}
    }
    const warnings = []
    if (node.exported === true && operation === 'replace_symbol_body') warnings.push('PUBLIC_API_SYMBOL')
    if (syntax.status === 'NOT_VALIDATED') warnings.push('SYNTAX_NOT_VALIDATED')
    if (syntax.status === 'PARSES_PERMISSIVE') warnings.push('SYNTAX_CHECK_PERMISSIVE')

    return {
        status: 'PLANNED',
        symbol: String(node.label || id),
        file,
        operation,
        plan: planEnvelope({operation, rawGraph, file, sha256: sha256Hex(buffer), edits: [edit], warnings, syntax}),
        syntaxCheck: syntax.status,
        completeness: 'COMPLETE',
    }
}
