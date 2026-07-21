// File-system session: dry-run and apply. All-or-nothing at every stage; any precondition
// failure reports which file broke and writes nothing. Rollback lives in rollback.mjs.

import {readFileSync, statSync, writeFileSync} from 'node:fs'
import {validateEditPlan, PlanValidationError} from './edit-plan.mjs'
import {applyEditsToContent, EditApplyError} from './edit-engine.mjs'
import {acquireRepoLock, sha256Hex, writeRollbackBundle} from './refactor-home.mjs'
import {assertRealPathInRepo, atomicWrite, MAX_FILE_BYTES, resolveInRepo} from './fs-io.mjs'

function loadEntry(repoRoot, fileEntry) {
    const absolute = resolveInRepo(repoRoot, fileEntry.path)
    let stats
    try {
        stats = statSync(absolute)
    } catch {
        return {path: fileEntry.path, status: 'MISSING', reason: 'file does not exist or is unreadable'}
    }
    if (!stats.isFile()) return {path: fileEntry.path, status: 'MISSING', reason: 'not a regular file'}
    if (stats.size > MAX_FILE_BYTES) return {path: fileEntry.path, status: 'FILE_TOO_LARGE', reason: `file exceeds the ${MAX_FILE_BYTES / 1024 / 1024} MB apply limit`}
    try {
        assertRealPathInRepo(absolute, repoRoot, fileEntry.path)
    } catch (error) {
        if (error instanceof PlanValidationError) return {path: fileEntry.path, status: 'PATH_ESCAPES_REPO', reason: error.message}
        throw error
    }
    const originalBuffer = readFileSync(absolute)
    const sha256Before = sha256Hex(originalBuffer)
    if (sha256Before !== fileEntry.sha256) {
        return {path: fileEntry.path, status: 'STALE', reason: 'file changed after the plan was computed', sha256Before}
    }
    const content = originalBuffer.toString('utf8')
    if (!Buffer.from(content, 'utf8').equals(originalBuffer)) {
        return {path: fileEntry.path, status: 'NOT_UTF8_TEXT', reason: 'file is not valid UTF-8 text; refusing to rewrite it'}
    }
    return {path: fileEntry.path, status: 'OK', absolute, originalBuffer, sha256Before, content}
}

// Validates the plan against the working tree and computes every result in memory.
// Never writes. Returns {ok, files:[{path, status, ...}]} — ok only when every file is READY.
export function dryRunPlan(plan, {repoRoot}) {
    validateEditPlan(plan)
    const files = plan.files.map((fileEntry) => {
        const loaded = loadEntry(repoRoot, fileEntry)
        if (loaded.status !== 'OK') return loaded
        try {
            const nextContent = applyEditsToContent(loaded.content, fileEntry.edits)
            const nextBuffer = Buffer.from(nextContent, 'utf8')
            if (nextBuffer.toString('utf8') !== nextContent) {
                // an edit split a surrogate pair or introduced a lone surrogate; encoding
                // would silently write U+FFFD replacement characters — refuse the lossy write
                return {path: fileEntry.path, status: 'EDIT_PRODUCES_INVALID_TEXT', reason: 'resulting content contains a lone UTF-16 surrogate; refusing a lossy write'}
            }
            return {
                path: fileEntry.path,
                status: 'READY',
                edits: fileEntry.edits.length,
                absolute: loaded.absolute,
                originalBuffer: loaded.originalBuffer,
                sha256Before: loaded.sha256Before,
                nextBuffer,
                sha256After: sha256Hex(nextBuffer),
            }
        } catch (error) {
            if (error instanceof EditApplyError) return {path: fileEntry.path, status: error.code, reason: error.message}
            throw error
        }
    })
    return {ok: files.every((file) => file.status === 'READY'), files}
}

const publicFileReport = (files) => files.map(({path, status, reason, edits}) => ({path, status, ...(reason ? {reason} : {}), ...(edits ? {edits} : {})}))

// Applies a validated plan under the per-repository lock: dry-run precheck, rollback
// bundle, then per-file atomic writes. A mid-apply failure restores every already-written
// file; if that restoration itself fails anywhere, the result says so honestly
// (ROLLBACK_INCOMPLETE) and the bundle stays available for rollback_last_apply.
// _writeFile is a test-only fault-injection seam.
export function applyPlan(plan, {repoRoot, _writeFile = writeFileSync}) {
    const lock = acquireRepoLock(repoRoot)
    if (!lock) return {status: 'REPO_BUSY', applied: 0, reason: 'another apply or rollback holds the repository lock; retry shortly'}
    try {
        const dryRun = dryRunPlan(plan, {repoRoot})
        if (!dryRun.ok) return {status: 'STALE', applied: 0, files: publicFileReport(dryRun.files)}
        const bundleDir = writeRollbackBundle({repoRoot, plan, entries: dryRun.files})
        const written = []
        for (const file of dryRun.files) {
            try {
                atomicWrite(file.absolute, file.nextBuffer, _writeFile)
                written.push(file)
            } catch (error) {
                const restoreFailed = []
                for (const done of written) {
                    try {
                        atomicWrite(done.absolute, done.originalBuffer, writeFileSync)
                    } catch (restoreError) {
                        restoreFailed.push({path: done.path, reason: restoreError.message})
                    }
                }
                const base = {
                    applied: 0,
                    failedFile: file.path,
                    reason: error.message,
                    rollbackBundle: bundleDir,
                    files: publicFileReport(dryRun.files),
                }
                if (restoreFailed.length) return {status: 'ROLLBACK_INCOMPLETE', ...base, restoreFailed}
                return {status: 'ROLLED_BACK', ...base}
            }
        }
        return {
            status: 'APPLIED',
            applied: written.length,
            totalEdits: written.reduce((sum, file) => sum + file.edits, 0),
            rollbackBundle: bundleDir,
            files: publicFileReport(dryRun.files),
        }
    } finally {
        lock.release()
    }
}

export {publicFileReport}
