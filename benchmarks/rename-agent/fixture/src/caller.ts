import { resolveTarget, resolveTargetPath } from './core';

export function run(input: string): string {
  return resolveTarget(input) + resolveTargetPath(input);
}

// Trap 2: the name inside a string literal. Must NOT change.
export const HELP = 'call resolveTarget with a selector';

// Trap 3: the name inside a comment: resolveTarget is documented here. Must NOT change.
export function describe(): string {
  return HELP;
}
