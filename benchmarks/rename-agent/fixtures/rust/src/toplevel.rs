use crate::core::resolve_target;

pub fn default_target() -> String {
    resolve_target("#main")
}
