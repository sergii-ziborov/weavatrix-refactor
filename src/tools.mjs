// MCP tools of the refactor extension. Contract with the core server:
// run(graph, args, ctx) -> toolResult(text, result, extra); ctx carries {repoRoot, graphPath}.
// Shared write machinery for every Weavatrix refactor workflow. Every write sits behind
// the environment gate plus a single-use, plan-bound confirm token.

import {toolResult} from 'weavatrix/extension/local-services'
import {PlanValidationError} from './edit-plan.mjs'
import {applyPlan, dryRunPlan} from './apply-session.mjs'
import {rollbackLastApply} from './rollback.mjs'
import {consumeConfirmToken, issueConfirmToken, TOKEN_TTL_MS} from './refactor-home.mjs'

const WRITE_GATE_ENV = 'WEAVATRIX_ALLOW_SOURCE_EDITS'

const writeGateOpen = () => process.env[WRITE_GATE_ENV] === '1'

const gateClosedResult = (toolName) => toolResult(
    `${toolName}: WRITE_GATE_CLOSED — the server was started without ${WRITE_GATE_ENV}=1. ` +
    'Opening the write gate is a deliberate user choice. Fallback: apply the plan edits with your own editor, then run verified_change phase=verify.',
    {status: 'WRITE_GATE_CLOSED', gate: WRITE_GATE_ENV},
)

const invalidPlanResult = (error) => toolResult(
    `INVALID_PLAN (${error.code}): ${error.message}. Nothing was checked or written.`,
    {status: 'INVALID_PLAN', code: error.code, reason: error.message},
)

const fileLines = (files) => files.map((file) => `- ${file.path}: ${file.status}${file.reason ? ` (${file.reason})` : ''}${file.edits ? ` [${file.edits} edits]` : ''}`).join('\n')

function previewRun(plan, ctx, toolName = 'apply_edit_plan') {
    const dryRun = dryRunPlan(plan, {repoRoot: ctx.repoRoot})
    if (!dryRun.ok) {
        const files = dryRun.files.map(({path, status, reason}) => ({path, status, ...(reason ? {reason} : {})}))
        return toolResult(
            `PREVIEW_BLOCKED — the plan does not match the working tree; nothing can be applied.\n${fileLines(files)}\nRe-run the producing preview tool for a fresh plan.`,
            {status: 'PREVIEW_BLOCKED', files},
        )
    }
    const {token, expiresAt} = issueConfirmToken({plan, repoRoot: ctx.repoRoot})
    const files = dryRun.files.map(({path, status, edits}) => ({path, status, edits}))
    const uncertain = Array.isArray(plan.uncertainReferences) ? plan.uncertainReferences.length : 0
    const text = [
        `PREVIEW_OK — every file hash and every 'before' text matches; the plan is applyable as-is.`,
        fileLines(files),
        uncertain ? `${uncertain} uncertainReferences remain outside this plan — they stay your responsibility after apply.` : null,
        `To apply: call ${toolName} again with the same operation inputs, mode="apply", and confirm_token="${token}" within ${Math.round(TOKEN_TTL_MS / 60000)} minutes. The token is single-use and bound to this exact plan and working tree.`,
    ].filter(Boolean).join('\n')
    return toolResult(text, {status: 'PREVIEW_OK', files, confirmToken: token, expiresAt, uncertainReferences: uncertain})
}

function applyRun(plan, args, ctx, toolName = 'apply_edit_plan') {
    if (!writeGateOpen()) return gateClosedResult(toolName)
    const consumed = consumeConfirmToken({token: args.confirm_token, plan, repoRoot: ctx.repoRoot})
    if (!consumed.ok) return toolResult(`${consumed.code}: ${consumed.reason}. Nothing was written.`, {status: consumed.code, reason: consumed.reason})
    const applied = applyPlan(plan, {repoRoot: ctx.repoRoot})
    if (applied.status === 'APPLIED') {
        const uncertain = Array.isArray(plan.uncertainReferences) ? plan.uncertainReferences.length : 0
        const text = [
            `APPLIED — ${applied.totalEdits} edits in ${applied.applied} files. Rollback bundle: ${applied.rollbackBundle}`,
            fileLines(applied.files),
            uncertain ? `${uncertain} uncertainReferences were NOT applied (unproven) — finish them yourself.` : null,
            `Follow up now: verified_change task=<task> phase=verify base_ref=<merge-base>. The next graph call auto-refreshes.`,
        ].filter(Boolean).join('\n')
        return toolResult(text, {...applied, uncertainReferences: uncertain})
    }
    const headlines = {
        ROLLED_BACK: `ROLLED_BACK — write failed on ${applied.failedFile} (${applied.reason}); every already-written file was restored. Originals also kept in ${applied.rollbackBundle}`,
        ROLLBACK_INCOMPLETE: `ROLLBACK_INCOMPLETE — write failed on ${applied.failedFile} AND ${applied.restoreFailed?.length || 0} file(s) could not be restored (${(applied.restoreFailed || []).map((f) => f.path).join(', ')}). The bundle is kept at ${applied.rollbackBundle}; unblock those files and run rollback_last_apply.`,
        REPO_BUSY: `REPO_BUSY — ${applied.reason}`,
        STALE: 'STALE — the working tree changed between preview and apply; nothing was written.',
    }
    const headline = headlines[applied.status] || `${applied.status}`
    return toolResult(applied.files ? `${headline}\n${fileLines(applied.files)}` : headline, applied)
}

const planningSummary = (planning = {}) => ({
    ...(planning.completeness ? {completeness: planning.completeness} : {}),
    ...(planning.backend ? {backend: planning.backend} : {}),
    ...(planning.kind ? {kind: planning.kind} : {}),
    ...(planning.oldName ? {oldName: planning.oldName} : {}),
    ...(planning.newName ? {newName: planning.newName} : {}),
    ...(Array.isArray(planning.renames) ? {renameCount: planning.renames.length} : {}),
    warnings: Array.isArray(planning.plan?.warnings)
        ? planning.plan.warnings
        : (Array.isArray(planning.warnings) ? planning.warnings : []),
})

// Shared two-phase executor for plan-producing tools that own their complete workflow. The
// producing tool recomputes its deterministic plan on the apply call; the token then proves
// that the recomputed plan and current working tree are byte-for-byte the previewed ones.
export function runEditPlanWorkflow({toolName, plan, args = {}, ctx, planning = {}}) {
    if (!ctx?.repoRoot) return toolResult('No active repository - open_repo first.', {status: 'NO_REPOSITORY'})
    try {
        const workflow = args.mode === 'apply'
            ? applyRun(plan, args, ctx, toolName)
            : previewRun(plan, ctx, toolName)
        return toolResult(
            `${toolName}: ${workflow.text}`,
            {...workflow.result, operation: toolName, planning: planningSummary(planning)},
            {warnings: workflow.warnings},
        )
    } catch (error) {
        if (error instanceof PlanValidationError) return invalidPlanResult(error)
        throw error
    }
}

const applyEditPlanTool = {
    name: 'apply_edit_plan',
    cap: 'edit',
    description: 'Apply a weavatrix.edit-plan.v1 envelope (from a weavatrix-refactor plan producer or weavatrix-online plan_refactor) to the active repository. mode="preview" (default) verifies hashes and before-texts and issues a single-use confirm_token; mode="apply" consumes the token and writes atomically with an automatic rollback bundle. Requires WEAVATRIX_ALLOW_SOURCE_EDITS=1 to write. Only EXACT_LSP/RESOLVED/EXTRACTED/LEXICAL_EXACT edits are ever applied; uncertain references are reported, never guessed.',
    inputSchema: {
        type: 'object',
        properties: {
            plan: {type: 'object', description: 'The weavatrix.edit-plan.v1 envelope, verbatim as produced by the planning tool'},
            mode: {type: 'string', enum: ['preview', 'apply'], default: 'preview'},
            confirm_token: {type: 'string', description: 'Required for mode="apply"; issued by the preview step, single-use, 5-minute TTL'},
        },
        required: ['plan'],
    },
    run: async (graph, args, ctx) => {
        if (!ctx?.repoRoot) return toolResult('No active repository — open_repo first.', {status: 'NO_REPOSITORY'})
        try {
            return runEditPlanWorkflow({toolName: 'apply_edit_plan', plan: args.plan, args, ctx})
        } catch (error) {
            if (error instanceof PlanValidationError) return invalidPlanResult(error)
            throw error
        }
    },
}

const rollbackTool = {
    name: 'rollback_last_apply',
    cap: 'edit',
    description: 'Restore the repository files from the most recent apply_edit_plan rollback bundle. All-or-nothing: if any target file changed after the apply, nothing is restored and the drifted files are reported. Requires WEAVATRIX_ALLOW_SOURCE_EDITS=1.',
    inputSchema: {type: 'object', properties: {}},
    run: async (graph, args, ctx) => {
        if (!ctx?.repoRoot) return toolResult('No active repository — open_repo first.', {status: 'NO_REPOSITORY'})
        if (!writeGateOpen()) return gateClosedResult('rollback_last_apply')
        const result = rollbackLastApply({repoRoot: ctx.repoRoot})
        const text = result.status === 'ROLLED_BACK'
            ? `ROLLED_BACK — ${result.restored} file(s) restored to their pre-apply state${result.alreadyOriginal ? ` (${result.alreadyOriginal} already original)` : ''}. Run verified_change phase=verify if the refactor is being retried.`
            : result.status === 'ROLLBACK_INCOMPLETE'
                ? `ROLLBACK_INCOMPLETE — restored ${result.restored.length}, failed ${result.failed.length} (${result.failed.map((f) => f.path).join(', ')}). ${result.reason}`
                : `${result.status}: ${result.reason}${result.files ? `\n${fileLines(result.files)}` : ''}`
        return toolResult(text, result)
    },
}

export const refactorTools = () => [applyEditPlanTool, rollbackTool]
