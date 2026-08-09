// Read-only primitives shared by the plan engines. Every function here was byte-identical in
// two or more engines before extraction; nothing was normalised on the way in. The variants
// that were NOT identical deliberately stayed with their engine:
//   - sql-rename-plan keeps its own bareName (strips quoting, takes the last dotted part);
//   - move-file-plan reads content only, so it unwraps this readFile at the call site.
// Engines are read-only plan producers, so this module must never import the write workflows.

import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {graphEndpointId, fileOfId, verifyArchitecture} from 'weavatrix-js/analysis-kit'

export const sha256Hex = (data) => createHash('sha256').update(data).digest('hex')

export const lineOfId = (id) => { const match = /@(\d+)$/.exec(String(id)); return match ? Number(match[1]) : 0 }

// Graph labels carry a trailing "()" on callables; the plan needs the bare identifier.
export const bareName = (value) => String(value || '').replace(/\s*\(.*$/, '').replace(/[()]/g, '').trim()

// null for a missing file AND for any file that is not exactly round-trippable UTF-8: a plan
// may only be built over bytes the applier can reproduce byte-for-byte.
export function readFile(repoRoot, file) {
    try {
        const buffer = readFileSync(resolve(repoRoot, file))
        const content = buffer.toString('utf8')
        return Buffer.from(content, 'utf8').equals(buffer) ? {content, buffer} : null
    } catch {
        return null
    }
}

// Word-boundary occurrences of `name` on a 1-based line (word char = [A-Za-z0-9_$], which
// keeps `$` inside identifiers for both JS and SQL). Quotes, backticks and brackets are
// boundaries, so a quoted "users" matches and only the inner name is rewritten.
// Returns [{startChar, endChar}].
export function occurrencesOnLine(content, line, name) {
    const text = content.split('\n')[line - 1]
    if (text === undefined) return []
    const hits = []
    let index = text.indexOf(name)
    while (index !== -1) {
        const before = text[index - 1]
        const after = text[index + name.length]
        const boundaryBefore = before === undefined || !/[A-Za-z0-9_$]/.test(before)
        const boundaryAfter = after === undefined || !/[A-Za-z0-9_$]/.test(after)
        if (boundaryBefore && boundaryAfter) hits.push({startChar: index, endChar: index + name.length})
        index = text.indexOf(name, index + 1)
    }
    return hits
}

// file -> Set(1-based lines) for every link into `symbolId` that `keep` accepts. The predicate
// is the only thing that differed between the call-site and the SQL-reference collectors.
export function linkLinesByFile(rawGraph, symbolId, keep) {
    const byFile = new Map()
    for (const link of rawGraph.links || []) {
        if (!keep(link)) continue
        if (graphEndpointId(link.target) !== symbolId) continue
        const file = fileOfId(graphEndpointId(link.source))
        if (!file || !Number.isInteger(Number(link.line))) continue
        const lines = byFile.get(file) || byFile.set(file, new Set()).get(file)
        lines.add(Number(link.line))
    }
    return byFile
}

// Byte-exact deletion range for the item at `index` in a comma-separated list (parameters,
// arguments, or import specifiers), consuming exactly one separating comma so the list stays
// well-formed. Callers add their own provenance.
export function removalRange(items, index, content) {
    const count = items.length
    const item = items[index]
    let from
    let to
    if (count === 1) { from = item.start; to = item.end }
    else if (index < count - 1) { from = item.start; to = items[index + 1].start }
    else { from = items[index - 1].end; to = item.end }
    return {startLine: from.line, startChar: from.char, endLine: to.line, endChar: to.char, before: content.slice(from.index, to.index), after: ''}
}

// Shared core of the move dry-runs: verify the contract against the real and the simulated
// graph, then diff still-active violations by fingerprint. Callers own their result shape and
// decide what a missing contract means, so the no-contract case never reaches here.
export function architectureDelta(graph, simulated, contract) {
    let before
    let after
    try {
        before = verifyArchitecture({graph, contract})
        after = verifyArchitecture({graph: simulated, contract})
    } catch (error) {
        return {status: 'UNAVAILABLE', reason: error?.message || 'architecture verification failed'}
    }
    const beforeActive = new Map([...before.new, ...before.existing].map((item) => [item.fingerprint, item]))
    const afterActive = new Map([...after.new, ...after.existing].map((item) => [item.fingerprint, item]))
    const wouldIntroduce = [...afterActive].filter(([fingerprint]) => !beforeActive.has(fingerprint)).map(([, item]) => item)
    const wouldFix = [...beforeActive].filter(([fingerprint]) => !afterActive.has(fingerprint)).map(([, item]) => item)
    const status = wouldIntroduce.length ? 'WOULD_VIOLATE' : wouldFix.length ? 'WOULD_IMPROVE' : 'NO_ARCHITECTURE_CHANGE'
    return {status, wouldIntroduce, wouldFix, violationsBefore: beforeActive.size, violationsAfter: afterActive.size}
}
