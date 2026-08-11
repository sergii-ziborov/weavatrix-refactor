// The symbol under rename: resolveTarget -> locateTarget.
export function resolveTarget(selector: string): string {
  if (selector.startsWith('#')) {
    return resolveTarget(selector.slice(1)); // recursive call: must be renamed
  }
  return selector.trim();
}

// Trap 1: a longer identifier sharing the prefix. Must NOT change.
export function resolveTargetPath(selector: string): string {
  return `/${resolveTarget(selector)}`;
}
