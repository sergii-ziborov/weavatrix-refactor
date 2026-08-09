//! The environment half of the three write gates.
//!
//! Gate one is that this package is installed at all — a read-only host has no refactor tools to
//! call. Gate two is this: the server must have been started with the variable set, which is a
//! deliberate act by whoever launched it and cannot be talked into existence by a tool argument.
//! Gate three is the plan-bound single-use confirmation token, which lives with the operation.
//!
//! The value is read once at startup. A gate that could be flipped mid-session by editing the
//! environment would not be a gate.

/// Whether this process may write to the repository, decided at startup.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WriteGate(bool);

impl WriteGate {
    /// The variable that opens the gate.
    pub const VARIABLE: &'static str = "WEAVATRIX_ALLOW_SOURCE_EDITS";

    /// Reads the gate from the environment.
    ///
    /// Only an exact `1` opens it. `true`, `yes` and `on` are deliberately not accepted: a
    /// destructive capability should be turned on by one documented value, not by guessing at
    /// what a user might have meant.
    #[must_use]
    pub fn from_environment() -> Self {
        Self(std::env::var(Self::VARIABLE).is_ok_and(|value| value == "1"))
    }

    /// An explicitly closed gate, for callers that never intend to write.
    #[cfg(test)]
    #[must_use]
    pub const fn closed() -> Self {
        Self(false)
    }

    /// Whether writes are permitted to proceed to the token check.
    #[must_use]
    pub const fn is_open(self) -> bool {
        self.0
    }
}

#[cfg(test)]
mod tests {
    use super::WriteGate;

    #[test]
    fn a_closed_gate_never_reports_open() {
        assert!(!WriteGate::closed().is_open());
    }

    #[test]
    fn the_variable_name_is_the_documented_one() {
        assert_eq!(WriteGate::VARIABLE, "WEAVATRIX_ALLOW_SOURCE_EDITS");
    }
}
