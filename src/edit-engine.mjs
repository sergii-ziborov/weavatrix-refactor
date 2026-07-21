// Pure in-memory edit application. No fs access here — the session layer owns files.
// Position convention (docs/edit-plan-schema.md): 1-based line, 0-based UTF-16 code-unit
// character, end exclusive. JS strings are UTF-16 code units, so native indexing is exact.
// Lines are split on '\n'; a trailing '\r' belongs to the line content (CRLF-safe: ranges
// produced by the same convention never straddle the '\r' unless the edit says so).

class EditApplyError extends Error {
    constructor(code, message, detail = {}) {
        super(message)
        this.code = code
        this.detail = detail
    }
}

const fail = (code, message, detail) => { throw new EditApplyError(code, message, detail) }

// Maps (1-based line, 0-based UTF-16 char) to an absolute string offset. Fails closed when
// the position lies outside the actual content rather than clamping.
export function offsetAt(content, line, character) {
    let lineStart = 0
    for (let current = 1; current < line; current += 1) {
        const nextBreak = content.indexOf('\n', lineStart)
        if (nextBreak === -1) fail('POSITION_OUT_OF_RANGE', `line ${line} exceeds file line count`, {line, character})
        lineStart = nextBreak + 1
    }
    const offset = lineStart + character
    const lineEndBreak = content.indexOf('\n', lineStart)
    const lineEnd = lineEndBreak === -1 ? content.length : lineEndBreak + 1
    if (offset > lineEnd || offset > content.length) {
        fail('POSITION_OUT_OF_RANGE', `character ${character} exceeds line ${line} length`, {line, character})
    }
    return offset
}

function resolveEdit(content, edit, index) {
    const start = offsetAt(content, edit.startLine, edit.startChar)
    const end = offsetAt(content, edit.endLine, edit.endChar)
    if (end < start) fail('POSITION_OUT_OF_RANGE', `edit ${index}: end precedes start`, {index})
    return {start, end, edit, index}
}

// Applies all edits to one file's content, all-or-nothing:
// 1. every range must resolve inside the content,
// 2. the exact 'before' text must match at every range (hash equality is necessary but this
//    is the last-line proof the plan describes THIS content),
// 3. ranges must not overlap,
// 4. splices run bottom-up so earlier edits never shift later ranges.
// Throws EditApplyError on the first violation; on success returns the new content.
export function applyEditsToContent(content, edits) {
    const resolved = edits.map((edit, index) => resolveEdit(content, edit, index))
    for (const {start, end, edit, index} of resolved) {
        const actual = content.slice(start, end)
        if (actual !== edit.before) {
            fail('BEFORE_MISMATCH', `edit ${index}: expected ${JSON.stringify(edit.before)} at ${edit.startLine}:${edit.startChar}, found ${JSON.stringify(actual)}`, {index, expected: edit.before, actual})
        }
    }
    // Descending offset; ties (e.g. two inserts at one position) break by descending array
    // index so the final text preserves the plan's array order.
    const ordered = [...resolved].sort((a, b) => b.start - a.start || b.end - a.end || b.index - a.index)
    for (let i = 1; i < ordered.length; i += 1) {
        // ordered descending: ordered[i] starts at or before ordered[i-1]; overlap when it ends past that start
        if (ordered[i].end > ordered[i - 1].start) {
            fail('OVERLAPPING_EDITS', `edits ${ordered[i].index} and ${ordered[i - 1].index} overlap`, {a: ordered[i].index, b: ordered[i - 1].index})
        }
    }
    let next = content
    for (const {start, end, edit} of ordered) {
        next = next.slice(0, start) + edit.after + next.slice(end)
    }
    return next
}

export {EditApplyError}
