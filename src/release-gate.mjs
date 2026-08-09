import {existsSync, readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import process from 'node:process'

const require = createRequire(import.meta.url)
const own = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))
const server = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8'))
const core = require('weavatrix-js/package.json')
const failures = []
const releaseNotes = new URL(`../docs/releases/v${own.version}.md`, import.meta.url)

if (own.private) failures.push('package.json private must be false or absent')
if (own.license !== 'MIT') failures.push('package.json license must be MIT')
if (own.dependencies?.['weavatrix-js'] !== '^0.3.16') failures.push(`weavatrix-js dependency must be ^0.3.16, found ${own.dependencies?.['weavatrix-js'] || '(missing)'}`)
if (!String(core.version).startsWith('0.3.')) failures.push(`weavatrix-js must be 0.3.x, found ${core.version}`)
if (lock.packages?.['']?.version !== own.version) failures.push('package-lock root version does not match package.json')
if (lock.packages?.['']?.license !== own.license) failures.push('package-lock root license does not match package.json')
if (lock.packages?.['node_modules/weavatrix-js']?.version !== core.version) failures.push('package-lock weavatrix-js version does not match the installed package')
if (server.version !== own.version || server.packages?.[0]?.version !== own.version) failures.push('MCP Registry metadata version does not match package.json')
if (server.name !== own.mcpName) failures.push('MCP Registry name does not match package mcpName')
if (server.description !== own.description) failures.push('MCP Registry description does not match package description')
if (server.packages?.[0]?.identifier !== own.name) failures.push('MCP Registry package identifier does not match package name')
if (!existsSync(releaseNotes) || !readFileSync(releaseNotes, 'utf8').trim()) failures.push('checked-in release notes are missing or empty')
for (const required of ['.weavatrix', 'bin', 'src', 'README.md', 'LICENSE', 'NOTICE', 'server.json']) {
  if (!own.files?.includes(required)) failures.push(`published package files must include ${required}`)
}
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${own.version}`) {
  failures.push(`tag ${process.env.GITHUB_REF_NAME || '(missing)'} does not match package v${own.version}`)
}

if (failures.length) {
  process.stderr.write(`weavatrix-refactor is not publishable yet:\n- ${failures.join('\n- ')}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`release gate passed for weavatrix-refactor ${own.version} over weavatrix-js ${core.version}\n`)
}
