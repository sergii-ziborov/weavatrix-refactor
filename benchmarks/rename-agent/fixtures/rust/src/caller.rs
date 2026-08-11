use crate::core::{resolve_target, resolve_target_path};

pub fn run(input: &str) -> String {
    let value = resolve_target(input);
    format!("{value}{}", resolve_target_path(input))
}

// Trap 2: the name inside a string literal. Must NOT change.
pub const HELP: &str = "call resolve_target with a selector";

// Trap 3: the name inside a comment: resolve_target is documented here. Must NOT change.
pub fn describe() -> &'static str {
    HELP
}
