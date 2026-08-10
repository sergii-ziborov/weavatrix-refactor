#!/usr/bin/env node
// MCP stdio entry - drop-in compatible with the 0.1.x JavaScript bin:
//   weavatrix-refactor-mcp <repoRoot>
// Spawns the native Rust server with stdio inherited; this wrapper adds no
// buffering, no framing, and no event-loop work between client and server.
import { runNative } from './run-native.mjs'

runNative('mcp', 'weavatrix-refactor-mcp')
