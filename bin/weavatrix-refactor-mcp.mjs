#!/usr/bin/env node
// Weavatrix MCP stdio entry with the refactor extension loaded. Same launcher
// contract as the core weavatrix-mcp bin; positional args pass through:
//   weavatrix-refactor-mcp <repoRoot> [caps]
//   weavatrix-refactor-mcp <graph.json> <repoRoot> [caps]
// Defaults to the 'refactor' profile (all offline core caps + 'edit').
const {startMcpServer} = await import('weavatrix/mcp-runtime')
const {refactorExtension} = await import('../src/extension.mjs')

await startMcpServer({
    defaultCapabilities: 'refactor',
    loadExtensions: async () => [refactorExtension()],
})
