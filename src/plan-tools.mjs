// Plan-producer refactoring tools. This is where refactoring LIVES: weavatrix-refactor is
// the refactoring MCP — it registers every refactoring operation (rename, move, delete
// readiness, change signature, bulk replace, organize imports, symbol edits) plus the apply
// side (tools.mjs). The engines themselves are read-only plan producers in this package's
// ./engines, composing the core's read-only weavatrix-js/analysis-kit surface; the core catalog
// registers none of them. Rename owns its preview/confirm/apply workflow; other tools return
// a weavatrix.edit-plan.v1 (or verdict/dry-run) for apply_edit_plan or direct review.

import {toolResult} from 'weavatrix-js/extension/local-services'
import {buildBulkReplacePlan} from './engines/bulk-replace-plan.js'
import {buildChangeSignaturePlan} from './engines/change-signature-plan.js'
import {buildGraphRenamePlan} from './engines/graph-rename-plan.js'
import {buildMoveFilePlan} from './engines/move-file-plan.js'
import {buildMoveSymbolDryRun} from './engines/move-symbol-dryrun.js'
import {buildOrganizeImportsPlan} from './engines/organize-imports-plan.js'
import {buildRelatedRenamePlan} from './engines/related-rename-plan.js'
import {buildRenamePlan} from './engines/rename-plan.js'
import {buildSqlRenamePlan} from './engines/sql-rename-plan.js'
import {buildSymbolEditPlan} from './engines/symbol-edit-plan.js'
import {computeDeleteReadiness} from './engines/delete-readiness.js'
import {runEditPlanWorkflow} from './tools.mjs'

const JS_TS_RE = /\.(?:c|m)?[jt]sx?$/i
const fileOf = (symbolId) => String(symbolId).split('#')[0]
const extOf = (file) => { const dot = file.lastIndexOf('.'); return dot >= 0 ? file.slice(dot).toLowerCase() : '' }

const MAX_LISTED_FILES = 20

// A bare count is not actionable: text mode has to name the files an agent would otherwise
// re-request as json, or the default output costs a round-trip to say the same thing.
const occurrenceFiles = (occurrences) => {
    if (!Array.isArray(occurrences) || !occurrences.length) return null
    const perFile = new Map()
    for (const {file} of occurrences) perFile.set(file, (perFile.get(file) || 0) + 1)
    const listed = [...perFile].slice(0, MAX_LISTED_FILES).map(([file, count]) => `- ${file}: ${count}`)
    if (perFile.size > MAX_LISTED_FILES) listed.push(`- … ${perFile.size - MAX_LISTED_FILES} more file(s)`)
    return listed.join('\n')
}

const summarize = (operation, result) => {
    const status = result?.status || 'UNKNOWN'
    const parts = [`${operation}: ${status}`]
    if (result?.completeness) parts.push(`completeness=${result.completeness}`)
    if (result?.verdict) parts.push(`verdict=${result.verdict}`)
    if (result?.reason) parts.push(result.reason)
    if (typeof result?.total === 'number') {
        const scanned = typeof result.scannedFiles === 'number' ? ` across ${result.scannedFiles} scanned file(s)` : ''
        parts.push(`${result.total} occurrence(s)${scanned}${result.capped ? ' (capped)' : ''}`)
    }
    const files = occurrenceFiles(result?.occurrences)
    if (files) parts.push(files)
    const warnings = result?.plan?.warnings || result?.warnings
    if (Array.isArray(warnings) && warnings.length) parts.push(`warnings: ${warnings.join(', ')}`)
    const uncertain = result?.plan?.uncertainReferences?.length ?? result?.uncertain?.length ?? result?.uncertainReferences?.length
    if (uncertain) parts.push(`${uncertain} uncertain reference(s) — your responsibility to review`)
    if (result?.next) parts.push(`next: ${result.next}`)
    return parts.join('\n')
}

const wrap = (operation, result) => toolResult(summarize(operation, result), result)

// Required-argument gate. The engines state their preconditions as thrown Errors naming
// internal parameters; that is a crash surface, not an agent contract. A missing or wrongly
// typed argument has to be a typed status like every other refusal in this package.
const ARG_KINDS = {
    string: (value) => typeof value === 'string' && value.trim() !== '',
    text: (value) => typeof value === 'string',
    object: (value) => !!value && typeof value === 'object' && !Array.isArray(value),
    array: (value) => Array.isArray(value) && value.length > 0,
}

const guard = (operation, spec, run) => async (graph, args, ctx) => {
    if (!ctx?.repoRoot) return wrap(operation, {status: 'NO_REPOSITORY', reason: 'no active repository — call open_repo first'})
    const invalid = Object.entries(spec).filter(([name, kind]) => !ARG_KINDS[kind](args?.[name]))
    if (invalid.length) {
        return wrap(operation, {
            status: 'INVALID_ARGS',
            invalid: invalid.map(([name]) => name),
            reason: `missing or invalid required argument(s): ${invalid.map(([name, kind]) => `${name} (${kind})`).join(', ')}. Nothing was planned or written.`,
        })
    }
    return run(graph, args, ctx)
}

// rename_symbol is ONE tool over every indexed language: it dispatches to the exact LSP
// backend for JS/TS, the SQL schema backend for .sql, and the graph+lexical backend for
// Rust/Python/Go/Java/C#/Solidity — honest provenance and completeness differ per backend.
async function renameDispatch({repoRoot, rawGraph, symbol, newName}) {
    const file = fileOf(symbol)
    if (JS_TS_RE.test(file)) return buildRenamePlan({repoRoot, rawGraph, targetId: symbol, newName})
    if (extOf(file) === '.sql') return buildSqlRenamePlan({repoRoot, rawGraph, symbolId: symbol, newName})
    return buildGraphRenamePlan({repoRoot, rawGraph, symbolId: symbol, newName})
}

const workflowProperties = {
    mode: {type: 'string', enum: ['preview', 'apply'], default: 'preview', description: 'preview verifies the generated plan and returns a confirm_token; apply recomputes the same plan and consumes that token'},
    confirm_token: {type: 'string', maxLength: 128, description: 'Required for mode="apply"; single-use and bound to the exact generated plan and working tree'},
}

const symbolSchema = {
    type: 'object',
    properties: {
        symbol: {type: 'string', description: 'Exact symbol id (file#name@line)'},
        new_name: {type: 'string'},
        ...workflowProperties,
    },
    required: ['symbol', 'new_name'],
}

const finishRename = (operation, planning, args, ctx) => planning?.status === 'PLANNED' && planning?.plan
    ? runEditPlanWorkflow({toolName: operation, plan: planning.plan, args, ctx, planning})
    : wrap(operation, planning)

export function planTools() {
    return [
        {
            cap: 'edit', name: 'rename_symbol', refreshGraph: true,
            description: 'Complete cross-language rename workflow: EXACT LSP backend for JS/TS, SQL schema backend for .sql, graph+lexical backend for Rust/Python/Go/Java/C#/Solidity. Default mode="preview" proves the byte-exact edits and returns a single-use confirm_token; repeat the same call with mode="apply" and that token for an atomic write with rollback. Requires WEAVATRIX_ALLOW_SOURCE_EDITS=1 only for apply.',
            inputSchema: symbolSchema,
            run: guard('rename_symbol', {symbol: 'string', new_name: 'string'}, async (graph, args, ctx) => finishRename(
                'rename_symbol',
                await renameDispatch({repoRoot: ctx.repoRoot, rawGraph: graph, symbol: args.symbol, newName: args.new_name}),
                args,
                ctx,
            )),
        },
        {
            cap: 'edit', name: 'rename_related_symbols', refreshGraph: true,
            description: 'Complete coordinated JS/TS multi-symbol rename as ONE atomic workflow with conflict/chain/swap detection. Default mode="preview" returns a plan-bound confirm_token; repeat with identical renames, mode="apply", and that token to write atomically with rollback. Blocks entirely if any sub-rename fails.',
            inputSchema: {type: 'object', properties: {renames: {type: 'array', minItems: 1, maxItems: 50, items: {type: 'object', properties: {symbol: {type: 'string'}, new_name: {type: 'string'}}, required: ['symbol', 'new_name']}}, ...workflowProperties}, required: ['renames']},
            run: guard('rename_related_symbols', {renames: 'array'}, async (graph, args, ctx) => finishRename(
                'rename_related_symbols',
                await buildRelatedRenamePlan({repoRoot: ctx.repoRoot, rawGraph: graph, renames: args.renames.map((entry) => ({targetId: entry?.symbol, newName: entry?.new_name}))}),
                args,
                ctx,
            )),
        },
        {
            cap: 'graph', name: 'move_file', refreshGraph: true,
            description: 'Relocate a JS/TS file: rewrites the moved file own imports and every importer specifier, and reports the architecture dry-run (WOULD_VIOLATE/WOULD_IMPROVE). A review plan the agent applies (it renames a file), not an apply envelope.',
            inputSchema: {type: 'object', properties: {from: {type: 'string'}, to: {type: 'string'}}, required: ['from', 'to']},
            run: guard('move_file', {from: 'string', to: 'string'}, async (graph, args, ctx) => wrap('move_file', buildMoveFilePlan({repoRoot: ctx.repoRoot, rawGraph: graph, fromPath: args.from, toPath: args.to}))),
        },
        {
            cap: 'graph', name: 'move_symbol', refreshGraph: true,
            description: 'Dry-run for moving a declaration to another file: predicts introduced/removed runtime cycles and architecture violations plus the blast radius. PROJECTED from graph edges — no byte-exact edits; apply the mechanical move yourself and run verified_change.',
            inputSchema: {type: 'object', properties: {symbol: {type: 'string'}, to_file: {type: 'string'}}, required: ['symbol', 'to_file']},
            run: guard('move_symbol', {symbol: 'string', to_file: 'string'}, async (graph, args, ctx) => wrap('move_symbol', buildMoveSymbolDryRun({rawGraph: graph, symbolId: args.symbol, toFile: args.to_file}))),
        },
        {
            cap: 'graph', name: 'delete_readiness', refreshGraph: true,
            description: 'Per-symbol deletion verdict {safe: true|false|UNPROVEN, knownReferences, unknownDynamicUsages, confidence, reason} plus the deletion span. Exported symbols cap at UNPROVEN; always REVIEW_REQUIRED, never auto-delete.',
            inputSchema: {type: 'object', properties: {symbol: {type: 'string'}}, required: ['symbol']},
            run: guard('delete_readiness', {symbol: 'string'}, async (graph, args, ctx) => wrap('delete_readiness', await computeDeleteReadiness({repoRoot: ctx.repoRoot, rawGraph: graph, graphPath: ctx.graphPath, targetId: args.symbol}))),
        },
        {
            cap: 'graph', name: 'change_signature', refreshGraph: true,
            description: 'Add or remove a function/method parameter (JS/TS) with byte-exact call-site argument surgery. Always PARTIAL (call sites from graph edges); spread/value-add reported UNCERTAIN. operation: {kind:"add_parameter",name,default?} | {kind:"remove_parameter",index}.',
            inputSchema: {type: 'object', properties: {symbol: {type: 'string'}, operation: {type: 'object'}}, required: ['symbol', 'operation']},
            run: guard('change_signature', {symbol: 'string', operation: 'object'}, async (graph, args, ctx) => wrap('change_signature', await buildChangeSignaturePlan({repoRoot: ctx.repoRoot, rawGraph: graph, symbolId: args.symbol, operation: args.operation}))),
        },
        {
            cap: 'graph', name: 'edit_symbol', refreshGraph: true,
            description: 'Symbol-anchored edit over the parser source range (all languages): replace_symbol_body | insert_before_symbol | insert_after_symbol. JS/TS results are parse-gated.',
            inputSchema: {type: 'object', properties: {symbol: {type: 'string'}, operation: {type: 'string', enum: ['replace_symbol_body', 'insert_before_symbol', 'insert_after_symbol']}, content: {type: 'string'}}, required: ['symbol', 'operation', 'content']},
            run: guard('edit_symbol', {symbol: 'string', operation: 'string', content: 'text'}, async (graph, args, ctx) => wrap('edit_symbol', await buildSymbolEditPlan({repoRoot: ctx.repoRoot, rawGraph: graph, targetId: args.symbol, operation: args.operation, content: args.content}))),
        },
        {
            cap: 'graph', name: 'bulk_replace', refreshGraph: true,
            description: 'Two-stage occurrence-selective pattern replace over the indexed universe. Preview (no selection) returns stable occurrence ids; then pass occurrence_ids or expected_count to plan. literal:true by default.',
            inputSchema: {type: 'object', properties: {pattern: {type: 'string'}, replacement: {type: 'string'}, literal: {type: 'boolean', default: true}, flags: {type: 'string'}, path_prefix: {type: 'string'}, occurrence_ids: {type: 'array', items: {type: 'string'}}, expected_count: {type: 'integer'}}, required: ['pattern', 'replacement']},
            run: guard('bulk_replace', {}, async (graph, args, ctx) => wrap('bulk_replace', buildBulkReplacePlan({repoRoot: ctx.repoRoot, rawGraph: graph, pattern: args.pattern, replacement: args.replacement, literal: args.literal, flags: args.flags, path_prefix: args.path_prefix, occurrence_ids: args.occurrence_ids ?? null, expected_count: args.expected_count ?? null}))),
        },
        {
            cap: 'graph', name: 'organize_imports', refreshGraph: true,
            description: 'Removes provably-unused named imports from a JS/TS file (a binding is removed only when its name occurs once in the file). Default/namespace imports are reported UNCERTAIN, never removed; sorting is left to the formatter.',
            inputSchema: {type: 'object', properties: {file: {type: 'string'}}, required: ['file']},
            run: guard('organize_imports', {file: 'string'}, async (graph, args, ctx) => wrap('organize_imports', await buildOrganizeImportsPlan({repoRoot: ctx.repoRoot, file: args.file}))),
        },
    ]
}
