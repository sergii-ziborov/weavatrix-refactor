#!/usr/bin/env node

export function packRecords(value) {
    if (Array.isArray(value)) return value.flatMap(packRecords)
    if (!value || typeof value !== 'object') return []
    if (typeof value.filename === 'string' || Array.isArray(value.files)) return [value]
    return Object.values(value).flatMap(packRecords)
}

export function packRecord(value) {
    const records = packRecords(value)
    const record = records.findLast(item => typeof item.filename === 'string') ?? records.at(-1)
    if (!record) throw new Error('npm pack JSON did not contain package metadata')
    return record
}

async function main() {
    const mode = process.argv[2]
    const input = await new Promise((resolve, reject) => {
        let body = ''
        process.stdin.setEncoding('utf8')
        process.stdin.on('data', chunk => { body += chunk })
        process.stdin.on('end', () => resolve(body))
        process.stdin.on('error', reject)
    })
    const record = packRecord(JSON.parse(input.replace(/^\uFEFF/, '')))
    if (mode === 'filename') {
        if (!record.filename) throw new Error('npm pack JSON did not report a filename')
        process.stdout.write(record.filename)
        return
    }
    if (mode === 'require-files') {
        const files = new Set((record.files ?? []).map(item => item.path))
        const missing = process.argv.slice(3).filter(path => !files.has(path))
        if (missing.length) throw new Error(`npm package is missing: ${missing.join(', ')}`)
        return
    }
    throw new Error('usage: npm-pack-json.mjs filename | require-files <path...>')
}

const entry = process.argv[1]?.replaceAll('\\', '/')
if (entry && import.meta.url.endsWith(entry)) {
    main().catch(error => {
        console.error(error.message)
        process.exitCode = 1
    })
}
