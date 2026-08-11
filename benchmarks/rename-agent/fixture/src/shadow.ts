// Trap 4: an unrelated symbol with the same name, module-local, never exported.
// A find-replace renames it; a symbol rename must not.
function resolveTarget(node: number): number {
  return node * 2;
}

export function pick(node: number): number {
  return resolveTarget(node);
}
