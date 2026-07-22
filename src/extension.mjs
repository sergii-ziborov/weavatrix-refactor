import {createRequire} from 'node:module'
import {defineWeavatrixExtension} from 'weavatrix/extension-api'
import {refactorTools} from './tools.mjs'
import {planTools} from './plan-tools.mjs'

const pkg = createRequire(import.meta.url)('../package.json')

// All seven offline core capabilities plus this package's write capability.
// Selecting the 'refactor' profile is one of the three gates; the other two are
// WEAVATRIX_ALLOW_SOURCE_EDITS=1 and a valid plan-bound confirm_token.
const CORE_CAPS = ['graph', 'search', 'source', 'health', 'build', 'retarget', 'crossrepo']

export const refactorExtension = () => defineWeavatrixExtension({
    name: 'refactor',
    version: pkg.version,
    profiles: {
        refactor: [...CORE_CAPS, 'edit'],
    },
    // apply/rollback carry cap 'edit' (gated by the write env + confirm token); the
    // plan-producer refactoring tools are read-only cap 'graph'. Together weavatrix-refactor
    // is the full refactoring MCP: produce a proven plan, then apply it. The core catalog
    // registers none of these — refactoring requires installing this package.
    tools: [...refactorTools(), ...planTools()],
    skills: [
        {name: 'weavatrix-refactor', path: 'skill/SKILL.md'},
    ],
})
