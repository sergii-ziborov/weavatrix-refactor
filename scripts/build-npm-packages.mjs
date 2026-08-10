// Assembles npm platform packages around prebuilt Weavatrix Refactor binaries.
// Node built-ins only: no third-party code, no install scripts, no network.
//
//   node scripts/build-npm-packages.mjs <platform-key> <binary-path> [version]
//   node scripts/build-npm-packages.mjs main [version]
//   node scripts/build-npm-packages.mjs current <platform-key> <binary-path> [version]
//   node scripts/build-npm-packages.mjs universal <artifacts-root> [version]
//
// Output lands in npm/dist/<package-name>/ ready for `npm publish`.
import {
    chmodSync,
    copyFileSync,
    cpSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WRAPPER = join(ROOT, 'npm', 'weavatrix-refactor')
const DIST = join(ROOT, 'npm', 'dist')

const PLATFORMS = {
    'win32-x64': { os: 'win32', cpu: 'x64', binary: 'weavatrix-refactor.exe' },
    'win32-arm64': { os: 'win32', cpu: 'arm64', binary: 'weavatrix-refactor.exe' },
    'darwin-x64': { os: 'darwin', cpu: 'x64', binary: 'weavatrix-refactor' },
    'darwin-arm64': { os: 'darwin', cpu: 'arm64', binary: 'weavatrix-refactor' },
    'linux-x64': { os: 'linux', cpu: 'x64', binary: 'weavatrix-refactor' },
    'linux-arm64': { os: 'linux', cpu: 'arm64', binary: 'weavatrix-refactor' },
}

const wrapperManifest = JSON.parse(
    readFileSync(join(WRAPPER, 'package.json'), 'utf8').replace(/^﻿/, ''))
const [, , mode, ...rest] = process.argv
if (!mode) usage()

if (mode === 'main') {
    const version = rest[0] || wrapperManifest.version
    const target = join(DIST, 'weavatrix-refactor')
    rmSync(target, { recursive: true, force: true })
    cpSync(WRAPPER, target, { recursive: true })
    const manifest = { ...wrapperManifest, version }
    writeFileSync(join(target, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    copyWrapperAssets(target)
    console.log(`assembled ${target} @ ${version}`)
} else if (mode === 'current') {
    const [platform, binaryPath, versionArg] = rest
    const entry = PLATFORMS[platform]
    if (!entry || !binaryPath) usage()
    const version = versionArg || wrapperManifest.version
    const target = join(DIST, 'weavatrix-refactor')
    rmSync(target, { recursive: true, force: true })
    cpSync(WRAPPER, target, { recursive: true })
    const manifest = { ...wrapperManifest, version }
    delete manifest.optionalDependencies
    writeFileSync(join(target, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    copyWrapperAssets(target)
    const destination = join(target, 'bin', 'native', platform, entry.binary)
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(binaryPath, destination)
    if (entry.os !== 'win32') chmodSync(destination, 0o755)
    console.log(`assembled current-platform universal ${target} @ ${version}`)
} else if (mode === 'universal') {
    const [artifactsRoot, versionArg] = rest
    if (!artifactsRoot) usage()
    const version = versionArg || wrapperManifest.version
    const target = join(DIST, 'weavatrix-refactor')
    rmSync(target, { recursive: true, force: true })
    cpSync(WRAPPER, target, { recursive: true })
    const manifest = { ...wrapperManifest, version }
    delete manifest.optionalDependencies
    writeFileSync(join(target, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    copyWrapperAssets(target)
    for (const [platform, { os, binary }] of Object.entries(PLATFORMS)) {
        const source = join(artifactsRoot, platform, binary)
        const destination = join(target, 'bin', 'native', platform, binary)
        mkdirSync(dirname(destination), { recursive: true })
        copyFileSync(source, destination)
        if (os !== 'win32') chmodSync(destination, 0o755)
    }
    console.log(`assembled universal ${target} @ ${version}`)
} else if (PLATFORMS[mode]) {
    const [binaryPath, versionArg] = rest
    if (!binaryPath) usage()
    const version = versionArg || wrapperManifest.version
    const { os, cpu, binary } = PLATFORMS[mode]
    const name = `@weavatrix/refactor-${mode}`
    const target = join(DIST, `refactor-${mode}`)
    rmSync(target, { recursive: true, force: true })
    mkdirSync(target, { recursive: true })
    copyFileSync(binaryPath, join(target, binary))
    if (os !== 'win32') chmodSync(join(target, binary), 0o755)
    copyFileSync(join(ROOT, 'LICENSE'), join(target, 'LICENSE'))
    writeFileSync(join(target, 'package.json'), `${JSON.stringify({
        name,
        version,
        description: `Weavatrix Refactor native binary for ${os} ${cpu}. Installed automatically by the weavatrix-refactor package.`,
        license: 'MIT',
        repository: wrapperManifest.repository,
        homepage: wrapperManifest.homepage,
        os: [os],
        cpu: [cpu],
        files: [binary, 'LICENSE'],
        preferUnplugged: true,
    }, null, 2)}\n`)
    writeFileSync(join(target, 'README.md'),
        `# ${name}\n\nNative Weavatrix Refactor binary for ${os} ${cpu}.\n` +
        'This package is installed automatically as an optional dependency of ' +
        '[weavatrix-refactor](https://www.npmjs.com/package/weavatrix-refactor); do not depend on it directly.\n')
    console.log(`assembled ${target} @ ${version}`)
} else {
    usage()
}

function copyWrapperAssets(target) {
    copyFileSync(join(ROOT, 'LICENSE'), join(target, 'LICENSE'))
    copyFileSync(join(ROOT, 'server.json'), join(target, 'server.json'))
}

function usage() {
    console.error('usage: node scripts/build-npm-packages.mjs <win32-x64|win32-arm64|darwin-x64|darwin-arm64|linux-x64|linux-arm64> <binary-path> [version]')
    console.error('   or: node scripts/build-npm-packages.mjs main [version]')
    console.error('   or: node scripts/build-npm-packages.mjs current <platform-key> <binary-path> [version]')
    console.error('   or: node scripts/build-npm-packages.mjs universal <artifacts-root> [version]')
    process.exit(2)
}
