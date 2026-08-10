#!/usr/bin/env node
// Full Weavatrix Refactor CLI: forwards arguments verbatim to the native binary.
import { runNative } from './run-native.mjs'

runNative(null, 'weavatrix-refactor')
