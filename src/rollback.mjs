// Rollback of the most recent apply. Retry-safe by construction: a file already at its
// pre-apply hash counts as ALREADY_ORIGINAL (not a conflict), so a partially restored or
// crashed-mid-apply tree converges to fully restored across retries instead of wedging.

import {readFileSync, renameSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {acquireRepoLock, latestRollbackBundle, sha256Hex} from './refactor-home.mjs'
import {assertRealPathInRepo, atomicWrite, resolveInRepo} from './fs-io.mjs'

function classifyEntry(repoRoot, entry) {
    const absolute = resolveInRepo(repoRoot, entry.path)
    let current
    try {
        current = readFileSync(absolute)
    } catch {
        return {entry, absolute, state: 'DRIFTED', reason: 'file missing'}
    }
    try {
        assertRealPathInRepo(absolute, repoRoot, entry.path)
    } catch (error) {
        return {entry, absolute, state: 'DRIFTED', reason: error.message}
    }
    const hash = sha256Hex(current)
    if (hash === entry.sha256After) return {entry, absolute, state: 'NEEDS_RESTORE'}
    if (hash === entry.sha256Before) return {entry, absolute, state: 'ALREADY_ORIGINAL'}
    return {entry, absolute, state: 'DRIFTED', reason: 'file changed after apply'}
}

// All-or-nothing against drift (any manually changed file blocks the whole restore), but
// per-file resilient against write failures: what could not be restored is reported and
// the bundle is kept, so rollback_last_apply can simply be re-run after unblocking.
export function rollbackLastApply({repoRoot}) {
    const lock = acquireRepoLock(repoRoot)
    if (!lock) return {status: 'REPO_BUSY', reason: 'another apply or rollback holds the repository lock; retry shortly'}
    try {
        const bundle = latestRollbackBundle(repoRoot)
        if (!bundle) return {status: 'NO_BUNDLE', reason: 'no rollback bundle exists for this repository'}
        const {dir, manifest} = bundle
        const checks = manifest.files.map((entry) => classifyEntry(repoRoot, entry))
        const drifted = checks.filter((check) => check.state === 'DRIFTED')
        if (drifted.length) {
            return {
                status: 'CONFLICT',
                reason: 'working tree changed after apply; refusing a blind restore',
                files: drifted.map(({entry, reason}) => ({path: entry.path, reason})),
            }
        }
        const failed = []
        const restored = []
        for (const {entry, absolute} of checks.filter((check) => check.state === 'NEEDS_RESTORE')) {
            try {
                atomicWrite(absolute, readFileSync(join(dir, 'files', String(entry.index))), writeFileSync)
                restored.push(entry.path)
            } catch (error) {
                failed.push({path: entry.path, reason: error.message})
            }
        }
        if (failed.length) {
            return {
                status: 'ROLLBACK_INCOMPLETE',
                restored,
                failed,
                reason: 'some files could not be restored; the bundle is kept — unblock the listed files and re-run rollback_last_apply',
            }
        }
        renameSync(join(dir, 'manifest.json'), join(dir, 'manifest.rolled-back.json'))
        return {
            status: 'ROLLED_BACK',
            restored: restored.length,
            alreadyOriginal: checks.length - restored.length,
            files: checks.map(({entry, state}) => ({path: entry.path, status: state === 'NEEDS_RESTORE' ? 'RESTORED' : state})),
        }
    } finally {
        lock.release()
    }
}
