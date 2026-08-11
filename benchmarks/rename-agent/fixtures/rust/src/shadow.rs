// Trap 4: an unrelated, module-local symbol with the same name. Must NOT change.
fn resolve_target(node: u32) -> u32 {
    node * 2
}

pub fn pick(node: u32) -> u32 {
    resolve_target(node)
}
