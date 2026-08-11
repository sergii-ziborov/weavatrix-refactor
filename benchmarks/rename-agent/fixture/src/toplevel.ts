import { resolveTarget } from './core';

// A call at module top level: no containing function, so it exercises the case
// that hid from graph edges in the 0.1.5 JS defect.
export const DEFAULT_TARGET = resolveTarget('#main');
