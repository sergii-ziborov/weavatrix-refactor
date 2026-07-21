// Validation for the weavatrix.edit-plan.v1 envelope — the frozen contract between the
// read-only weavatrix core (plan producer) and this package (plan applier).
// See docs/edit-plan-schema.md. Fail closed: an invalid plan is rejected whole.

export const EDIT_PLAN_SCHEMA = 'weavatrix.edit-plan.v1'

// Only provenance tiers that carry exact, proven ranges may be applied. INFERRED and
// CONFLICT evidence belongs in uncertainReferences/notModified, never in edits.
// LEXICAL_EXACT marks pattern-level edits (bulk_replace): their proof is the byte-exact
// before-text itself, re-verified under the file hash at apply time — an honest label,
// not a claim of parser or language-server evidence.
export const APPLYABLE_PROVENANCE = new Set(['EXACT_LSP', 'RESOLVED', 'EXTRACTED', 'LEXICAL_EXACT'])

const MAX_FILES = 500
const MAX_EDITS_PER_FILE = 2000
const SHA256_RE = /^[0-9a-f]{64}$/

class PlanValidationError extends Error {
    constructor(code, message) {
        super(message)
        this.code = code
    }
}

const fail = (code, message) => { throw new PlanValidationError(code, message) }

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

// Paths in a plan are repo-relative with forward slashes. Absolute paths, drive letters,
// backslashes, empty segments, ':' (NTFS streams), any '..' traversal and any .git segment
// are rejected before touching the fs. Windows silently strips trailing dots/spaces from
// path segments, so the checks run on that stripped, lowercased canonical form.
export function validatePlanPath(path) {
    if (typeof path !== 'string' || !path.length) fail('INVALID_PATH', 'file path must be a non-empty string')
    if (path.includes('\\')) fail('INVALID_PATH', `file path must use forward slashes: ${path}`)
    if (path.includes(':')) fail('INVALID_PATH', `file path may not contain ':': ${path}`)
    if (path.startsWith('/')) fail('INVALID_PATH', `file path must be repo-relative: ${path}`)
    for (const segment of path.split('/')) {
        if (!segment.length) fail('INVALID_PATH', `file path has an empty segment: ${path}`)
        const canonical = segment.replace(/[. ]+$/, '').toLowerCase()
        if (!canonical.length || canonical === '..') fail('INVALID_PATH', `file path may not traverse: ${path}`)
        if (canonical === '.git') fail('INVALID_PATH', `file path may not target .git: ${path}`)
    }
    return path
}

function validateEdit(edit, path, index) {
    if (!isPlainObject(edit)) fail('INVALID_EDIT', `${path} edit ${index} must be an object`)
    for (const field of ['startLine', 'startChar', 'endLine', 'endChar']) {
        if (!Number.isInteger(edit[field]) || edit[field] < 0) fail('INVALID_EDIT', `${path} edit ${index}: ${field} must be a non-negative integer`)
    }
    if (edit.startLine < 1 || edit.endLine < 1) fail('INVALID_EDIT', `${path} edit ${index}: lines are 1-based`)
    if (edit.endLine < edit.startLine || (edit.endLine === edit.startLine && edit.endChar < edit.startChar)) {
        fail('INVALID_EDIT', `${path} edit ${index}: end must not precede start`)
    }
    if (typeof edit.before !== 'string') fail('INVALID_EDIT', `${path} edit ${index}: 'before' text is mandatory`)
    if (typeof edit.after !== 'string') fail('INVALID_EDIT', `${path} edit ${index}: 'after' text is mandatory`)
    if (edit.before === edit.after) fail('INVALID_EDIT', `${path} edit ${index}: before and after are identical`)
    if (!APPLYABLE_PROVENANCE.has(edit.provenance)) {
        fail('UNPROVEN_EDIT', `${path} edit ${index}: provenance ${edit.provenance || '(missing)'} is not applyable; only ${[...APPLYABLE_PROVENANCE].join('/')} edits may be applied`)
    }
    return edit
}

function validateFileEntry(entry, index) {
    if (!isPlainObject(entry)) fail('INVALID_FILE', `files[${index}] must be an object`)
    validatePlanPath(entry.path)
    if (typeof entry.sha256 !== 'string' || !SHA256_RE.test(entry.sha256)) fail('INVALID_FILE', `${entry.path}: sha256 must be a lowercase hex sha-256`)
    if (!Array.isArray(entry.edits) || !entry.edits.length) fail('INVALID_FILE', `${entry.path}: edits must be a non-empty array`)
    if (entry.edits.length > MAX_EDITS_PER_FILE) fail('PLAN_TOO_LARGE', `${entry.path}: more than ${MAX_EDITS_PER_FILE} edits`)
    entry.edits.forEach((edit, editIndex) => validateEdit(edit, entry.path, editIndex))
    return entry
}

// Validates the whole envelope and returns it frozen. Throws PlanValidationError with a
// stable code; callers surface {status: 'INVALID_PLAN', code, reason} — never a partial accept.
export function validateEditPlan(plan) {
    if (!isPlainObject(plan)) fail('INVALID_PLAN', 'plan must be an object')
    if (plan.schemaVersion !== EDIT_PLAN_SCHEMA) fail('SCHEMA_MISMATCH', `plan schemaVersion must be ${EDIT_PLAN_SCHEMA}, got ${plan.schemaVersion || '(missing)'}`)
    if (typeof plan.operation !== 'string' || !plan.operation.length) fail('INVALID_PLAN', 'plan.operation is required')
    if (!Array.isArray(plan.files) || !plan.files.length) fail('INVALID_PLAN', 'plan.files must be a non-empty array')
    if (plan.files.length > MAX_FILES) fail('PLAN_TOO_LARGE', `plan touches more than ${MAX_FILES} files`)
    const seen = new Set()
    plan.files.forEach((entry, index) => {
        validateFileEntry(entry, index)
        if (seen.has(entry.path)) fail('INVALID_PLAN', `duplicate file entry: ${entry.path}`)
        seen.add(entry.path)
    })
    if (plan.completeness !== undefined && plan.completeness !== 'COMPLETE' && plan.completeness !== 'PARTIAL') {
        fail('INVALID_PLAN', `plan.completeness must be COMPLETE or PARTIAL when present`)
    }
    return plan
}

export {PlanValidationError}
