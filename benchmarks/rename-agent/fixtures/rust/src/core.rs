// The symbol under rename: resolve_target -> locate_target.
pub fn resolve_target(selector: &str) -> String {
    if selector.starts_with('#') {
        return resolve_target(&selector[1..]);
    }
    selector.trim().to_owned()
}

// Trap 1: a longer identifier sharing the prefix. Must NOT change.
pub fn resolve_target_path(selector: &str) -> String {
    format!("/{}", resolve_target(selector))
}
