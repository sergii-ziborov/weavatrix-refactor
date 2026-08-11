# The symbol under rename: resolve_target -> locate_target.
def resolve_target(selector: str) -> str:
    if selector.startswith("#"):
        return resolve_target(selector[1:])
    return selector.strip()


# Trap 1: a longer identifier sharing the prefix. Must NOT change.
def resolve_target_path(selector: str) -> str:
    return f"/{resolve_target(selector)}"
