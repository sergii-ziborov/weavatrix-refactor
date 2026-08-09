// move_symbol DRY-RUN evaluator (ADR 0002). Unlike move_file (a pure relocate whose cycle
// topology is invariant), moving a DECLARATION between files changes which file imports
// which, so it can create or remove runtime cycles â€” the load-bearing, uniquely-weavatrix
// verdict here. This computes that verdict plus the architecture delta and the blast radius,
// all PROJECTED from graph edges (not a rebuild): the moved symbol's target file B inherits
// every file X depends on (B->C edges) and every importer of X now reaches B (F->B edges).
// It deliberately does NOT synthesize byte-exact import rewrites â€” the calling agent applies
// the mechanical edits with the blast radius below and then proves the result with
// verified_change. Old edges are retained (removal is not statically proven), which keeps
// new-cycle detection from inventing cycles that only old-only edges could form.

import {buildFileImportGraph, findSccs} from 'weavatrix-js/analysis-kit'
import {fileOfId, graphEndpointId} from 'weavatrix-js/analysis-kit'
import {architectureDelta} from './engine-kit.js'

const USE_RELATIONS = new Set(['calls', 'references'])

const sccMembership = (components) => {
    const map = new Map()
    for (const component of components) {
        // Keep the collision-safe separator escaped in source. A literal NUL is valid
        // JavaScript, but repository scanners correctly treat NUL-bearing files as binary.
        const key = [...component].sort().join('\0')
        for (const member of component) map.set(member, key)
    }
    return map
}

// Files X's outbound uses reach (X depends on them) and files that use X (importers).
function fileRelations(graph, symbolId, sourceFile, toFile) {
    const outDepFiles = new Set()
    const importerFiles = new Set()
    for (const link of graph.links || []) {
        if (!USE_RELATIONS.has(String(link.relation))) continue
        const source = graphEndpointId(link.source)
        const target = graphEndpointId(link.target)
        if (source === symbolId) {
            const file = fileOfId(target)
            if (file && file !== toFile && file !== symbolId) outDepFiles.add(file)
        }
        if (target === symbolId) {
            const file = fileOfId(source)
            if (file && file !== toFile) importerFiles.add(file)
        }
    }
    // X's own file is legitimately both a dependency (siblings X uses -> B imports A, the
    // B->A back-edge that is the main new-cycle source) and an importer (siblings that use
    // X -> A imports B); the per-edge file mapping above captures both.
    return {outDepFiles, importerFiles}
}

function projectedImportEdges({sourceFile, toFile, outDepFiles, importerFiles}) {
    const edges = []
    for (const file of importerFiles) edges.push({from: file, to: toFile})
    for (const file of outDepFiles) edges.push({from: toFile, to: file})
    return edges.filter((edge) => edge.from !== edge.to)
}

function cycleDelta(graph, projected) {
    const {runtimeAdj} = buildFileImportGraph(graph)
    const before = findSccs(runtimeAdj)
    const after = new Map()
    for (const [node, targets] of runtimeAdj) after.set(node, new Set(targets))
    for (const edge of projected) {
        if (!after.has(edge.from)) after.set(edge.from, new Set())
        after.get(edge.from).add(edge.to)
    }
    const afterComponents = findSccs(after)
    const beforeMembership = sccMembership(before)
    const introduced = afterComponents.filter((component) => {
        const key = [...component].sort().join('\0')
        return !component.every((member) => beforeMembership.get(member) === key)
    })
    const afterMembership = sccMembership(afterComponents)
    const removed = before.filter((component) => {
        const key = [...component].sort().join('\0')
        return !component.every((member) => afterMembership.get(member) === key)
    })
    return {introduced, removed, cyclesBefore: before.length, cyclesAfter: afterComponents.length}
}

function simulateSymbolGraph(graph, symbolId, sourceFile, toFile, projected) {
    const newId = `${toFile}${symbolId.slice(sourceFile.length)}`
    const remap = (endpoint) => {
        const value = graphEndpointId(endpoint)
        if (value !== symbolId) return endpoint
        return endpoint && typeof endpoint === 'object' ? {...endpoint, id: newId} : newId
    }
    const nodes = (graph.nodes || []).map((node) => (String(node.id) === symbolId ? {...node, id: newId, source_file: toFile} : node))
    const links = (graph.links || []).map((link) => {
        const source = remap(link.source)
        const target = remap(link.target)
        return source === link.source && target === link.target ? link : {...link, source, target}
    })
    for (const edge of projected) links.push({source: edge.from, target: edge.to, relation: 'imports', confidence: 'EXTRACTED', projected: true})
    return {...graph, nodes, links}
}

// This dry-run reports the delta only; the violation counts the shared helper also returns are
// move_file's contract, not this one.
function architectureVerdict(graph, simulated, contract) {
    if (!contract) return {status: 'NOT_CONFIGURED'}
    const {violationsBefore, violationsAfter, ...delta} = architectureDelta(graph, simulated, contract)
    return delta
}

export function buildMoveSymbolDryRun({rawGraph, symbolId, toFile, contract = null} = {}) {
    if (!rawGraph || !symbolId || !toFile) throw new Error('move_symbol dry-run requires rawGraph, symbolId, and toFile')
    const id = String(symbolId)
    if (!id.includes('#')) return {status: 'NOT_A_SYMBOL', reason: 'move_symbol operates on a symbol node (file#name@line), not a file'}
    const node = (rawGraph.nodes || []).find((candidate) => String(candidate.id) === id)
    if (!node) return {status: 'NOT_FOUND', reason: 'the symbol is not present in the active graph'}
    const sourceFile = fileOfId(id)
    if (sourceFile === String(toFile)) return {status: 'NO_CHANGE', reason: 'the symbol already lives in the target file'}

    const {outDepFiles, importerFiles} = fileRelations(rawGraph, id, sourceFile, String(toFile))
    const projected = projectedImportEdges({sourceFile, toFile: String(toFile), outDepFiles, importerFiles})
    const cycles = cycleDelta(rawGraph, projected)
    const simulated = simulateSymbolGraph(rawGraph, id, sourceFile, String(toFile), projected)
    const architecture = architectureVerdict(rawGraph, simulated, contract)

    const warnings = []
    if (cycles.introduced.length) warnings.push('WOULD_INTRODUCE_RUNTIME_CYCLE')
    if (architecture.status === 'WOULD_VIOLATE') warnings.push('WOULD_INTRODUCE_ARCHITECTURE_VIOLATION')

    const verdict = cycles.introduced.length || architecture.status === 'WOULD_VIOLATE'
        ? 'BLOCKED_PREDICTED'
        : 'FEASIBLE'
    return {
        status: 'EVALUATED',
        verdict,
        move: {symbol: String(node.label || id), from: sourceFile, to: String(toFile)},
        cycles: {
            introduced: cycles.introduced.map((component) => [...component].sort()),
            removed: cycles.removed.map((component) => [...component].sort()),
            before: cycles.cyclesBefore,
            after: cycles.cyclesAfter,
        },
        architecture,
        blastRadius: {
            importers: [...importerFiles].sort(),
            newDependencies: [...outDepFiles].sort(),
            projectedEdges: projected,
        },
        warnings,
        fidelity: 'PROJECTED_FROM_GRAPH_EDGES',
        note: 'a prediction from simulated graph edges, not a rebuild: retained edges keep new-cycle detection sound, but apply the move and run verified_change phase=verify for the authoritative result. This dry-run computes no byte-exact edits â€” apply the mechanical relocation using the blast radius above.',
    }
}
