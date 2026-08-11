from src.core import resolve_target, resolve_target_path


def run(value: str) -> str:
    return resolve_target(value) + resolve_target_path(value)


# Trap 2: the name inside a string literal. Must NOT change.
HELP = "call resolve_target with a selector"

# Trap 3: the name inside a comment: resolve_target is documented here. Must NOT change.
def describe() -> str:
    return HELP
