// Shared file-system primitives for apply and rollback. Containment is checked twice:
// lexically (resolveInRepo) and through every symlink/junction (assertRealPathInRepo) —
// a link inside the repository must never redirect a write outside of it.

import {realpathSync, renameSync, rmSync} from 'node:fs'
import {resolve, sep} from 'node:path'
import {randomBytes} from 'node:crypto'
import {PlanValidationError} from './edit-plan.mjs'

// V8 string conversion, not Buffer, is the practical ceiling; refuse early with a clean status.
export const MAX_FILE_BYTES = 16 * 1024 * 1024

// Windows paths are case-insensitive; compare canonically there.
const canonical = (path) => (process.platform === 'win32' ? path.toLowerCase() : path)

const contains = (root, candidate) => canonical(candidate) === canonical(root) || canonical(candidate).startsWith(canonical(root + sep))

export const resolveInRepo = (repoRoot, planPath) => {
    const root = resolve(String(repoRoot))
    const absolute = resolve(root, planPath)
    if (!contains(root, absolute)) {
        throw new PlanValidationError('PATH_ESCAPES_REPO', `plan path resolves outside the repository: ${planPath}`)
    }
    return absolute
}

// Follows the full link chain of an EXISTING file and requires its real location to stay
// inside the real repository root. Callers handle missing files before calling this.
export function assertRealPathInRepo(absolute, repoRoot, planPath) {
    const real = realpathSync(absolute)
    const realRoot = realpathSync(resolve(String(repoRoot)))
    if (!contains(realRoot, real)) {
        throw new PlanValidationError('PATH_ESCAPES_REPO', `plan path escapes the repository through a link: ${planPath}`)
    }
}

// Write-to-temp + rename. The temp file is removed on ANY failure so an aborted apply
// never leaves *.weavatrix-tmp-* litter in the working tree.
export const atomicWrite = (absolute, buffer, writeFile) => {
    const tmp = `${absolute}.weavatrix-tmp-${randomBytes(4).toString('hex')}`
    try {
        writeFile(tmp, buffer)
        renameSync(tmp, absolute)
    } catch (error) {
        rmSync(tmp, {force: true})
        throw error
    }
}
