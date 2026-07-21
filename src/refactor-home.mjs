// Out-of-repo state: confirm tokens and rollback bundles. Nothing here ever lives inside
// the target repository (the architecture-bootstrap precedent from the core). The location
// is overridable for tests via WEAVATRIX_REFACTOR_HOME.

import {createHash, randomBytes} from 'node:crypto'
import {mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {join, resolve} from 'node:path'

export const TOKEN_TTL_MS = 5 * 60 * 1000

export const refactorHome = () => process.env.WEAVATRIX_REFACTOR_HOME || join(homedir(), '.weavatrix-refactor')

export const sha256Hex = (data) => createHash('sha256').update(data).digest('hex')

// One stable directory key per repository root, independent of path separators or case.
export const repoKey = (repoRoot) => sha256Hex(resolve(String(repoRoot)).toLowerCase().replaceAll('\\', '/')).slice(0, 24)

export const planHash = (plan) => sha256Hex(JSON.stringify(plan))

const tokensDir = () => join(refactorHome(), 'tokens')

// Issues a single-use confirm token bound to the exact plan content and repository.
export function issueConfirmToken({plan, repoRoot, now = Date.now()}) {
    const token = randomBytes(24).toString('hex')
    const record = {
        token,
        repoKey: repoKey(repoRoot),
        planHash: planHash(plan),
        issuedAt: now,
        expiresAt: now + TOKEN_TTL_MS,
    }
    mkdirSync(tokensDir(), {recursive: true})
    writeFileSync(join(tokensDir(), `${token}.json`), JSON.stringify(record), {flag: 'wx'})
    return {token, expiresAt: record.expiresAt}
}

// Consumes (single use) and verifies a token. Returns {ok} or {ok:false, code, reason};
// the token file is deleted on every terminal outcome except "unknown token".
export function consumeConfirmToken({token, plan, repoRoot, now = Date.now()}) {
    if (typeof token !== 'string' || !/^[0-9a-f]{48}$/.test(token)) return {ok: false, code: 'TOKEN_UNKNOWN', reason: 'confirm_token is missing or malformed'}
    const path = join(tokensDir(), `${token}.json`)
    let record
    try {
        record = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
        return {ok: false, code: 'TOKEN_UNKNOWN', reason: 'confirm_token is unknown (tokens are single-use; re-run the preview)'}
    }
    rmSync(path, {force: true})
    if (record.expiresAt < now) return {ok: false, code: 'TOKEN_EXPIRED', reason: 'confirm_token expired (5-minute TTL); re-run the preview'}
    if (record.repoKey !== repoKey(repoRoot)) return {ok: false, code: 'TOKEN_REPO_MISMATCH', reason: 'confirm_token was issued for a different repository'}
    if (record.planHash !== planHash(plan)) return {ok: false, code: 'TOKEN_PLAN_MISMATCH', reason: 'confirm_token was issued for a different plan; re-run the preview'}
    return {ok: true}
}

const LOCK_STALE_MS = 60 * 1000

// One writer per repository at a time: apply and rollback both take this lock, so two
// concurrent sessions can never interleave writes. Returns null when the lock is held;
// a lock older than 60s is treated as abandoned (crashed process) and stolen once.
export function acquireRepoLock(repoRoot, {now = Date.now()} = {}) {
    const dir = join(refactorHome(), 'locks')
    mkdirSync(dir, {recursive: true})
    const path = join(dir, `${repoKey(repoRoot)}.lock`)
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            writeFileSync(path, JSON.stringify({pid: process.pid, at: now}), {flag: 'wx'})
            return {release: () => rmSync(path, {force: true})}
        } catch {
            let holder = null
            try {
                holder = JSON.parse(readFileSync(path, 'utf8'))
            } catch {
                // unreadable lock — treat as stale
            }
            if (holder && now - holder.at < LOCK_STALE_MS) return null
            rmSync(path, {force: true})
        }
    }
    return null
}

const bundlesDir = (repoRoot) => join(refactorHome(), 'rollback', repoKey(repoRoot))

// Persists original file contents before any write. Returns the bundle directory.
export function writeRollbackBundle({repoRoot, plan, entries, now = Date.now()}) {
    const dir = join(bundlesDir(repoRoot), `${now}-${randomBytes(4).toString('hex')}`)
    mkdirSync(join(dir, 'files'), {recursive: true})
    entries.forEach((entry, index) => writeFileSync(join(dir, 'files', String(index)), entry.originalBuffer))
    const manifest = {
        schemaVersion: 'weavatrix.rollback.v1',
        createdAt: now,
        repoRoot: resolve(String(repoRoot)),
        planHash: planHash(plan),
        operation: plan.operation,
        files: entries.map((entry, index) => ({
            index,
            path: entry.path,
            sha256Before: entry.sha256Before,
            sha256After: entry.sha256After,
        })),
    }
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
    return dir
}

// Latest unconsumed bundle for the repository, or null.
export function latestRollbackBundle(repoRoot) {
    let names
    try {
        names = readdirSync(bundlesDir(repoRoot))
    } catch {
        return null
    }
    const candidates = names.filter((name) => /^\d+-[0-9a-f]{8}$/.test(name)).sort()
    while (candidates.length) {
        const dir = join(bundlesDir(repoRoot), candidates.pop())
        try {
            const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
            return {dir, manifest}
        } catch {
            // consumed (manifest renamed) or corrupt — keep walking back
        }
    }
    return null
}
