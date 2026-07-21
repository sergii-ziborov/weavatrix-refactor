import {createRequire} from 'node:module'
import {defineWeavatrixExtension} from 'weavatrix/extension-api'

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
    // Tools land here once the edit engine exists: apply_edit_plan, rollback_last_apply.
    // They are registered with cap 'edit' so no core profile can ever enable them.
    tools: [],
    skills: [
        {name: 'weavatrix-refactor', path: 'skill/SKILL.md'},
    ],
})
