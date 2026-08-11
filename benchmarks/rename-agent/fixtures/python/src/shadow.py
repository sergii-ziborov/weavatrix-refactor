# Trap 4: an unrelated, module-local symbol with the same name. Must NOT change.
def resolve_target(node: int) -> int:
    return node * 2


def pick(node: int) -> int:
    return resolve_target(node)
