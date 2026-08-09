use crate::mcp::ports::RepositoryPort;
use crate::write_gate::WriteGate;
use blazingly_json::{Value, json};
use std::collections::BTreeSet;
use std::io;
use std::path::{Path, PathBuf};
use weavatrix_rust::{Error, Weavatrix, operations};
use weavatrix_rust_refactor::operations as refactor;

/// The merged catalog: every read-only operation of the engine, plus the eleven refactor tools.
///
/// The two halves are kept separable on purpose. A name that exists in both would make the
/// dispatch below ambiguous, so the merge refuses it rather than silently preferring one.
pub(crate) struct ToolCatalog {
    pub(crate) encoded: Value,
    pub(crate) names: BTreeSet<String>,
    pub(crate) refactor_names: BTreeSet<String>,
}

impl ToolCatalog {
    pub(crate) fn merged() -> io::Result<Self> {
        let read_only = operations::catalog_for_profile(operations::ToolProfile::All);
        let mut names = read_only
            .iter()
            .map(|definition| definition.name.to_owned())
            .collect::<BTreeSet<_>>();
        let mut encoded = blazingly_json::to_value(read_only)
            .map_err(io::Error::other)?
            .as_array()
            .cloned()
            .unwrap_or_default();

        let refactor_names = refactor::catalog_names()
            .into_iter()
            .collect::<BTreeSet<_>>();
        if let Some(clash) = refactor_names.iter().find(|name| names.contains(*name)) {
            return Err(io::Error::other(format!(
                "tool {clash} is declared by both the read-only engine and the refactor contract"
            )));
        }
        if let Some(tools) = refactor::catalog().as_array() {
            encoded.extend(tools.iter().cloned());
        }
        names.extend(refactor_names.iter().cloned());
        Ok(Self {
            encoded: Value::Array(encoded),
            names,
            refactor_names,
        })
    }
}

pub(crate) struct RefactorRepository {
    root: PathBuf,
    engine: Option<Weavatrix>,
    refactor_names: BTreeSet<String>,
    gate: WriteGate,
}

impl RefactorRepository {
    pub(crate) fn open(
        root: PathBuf,
        refactor_names: BTreeSet<String>,
        gate: WriteGate,
    ) -> Result<Self, Error> {
        let engine = Weavatrix::open(&root)?;
        Ok(Self {
            root,
            engine: Some(engine),
            refactor_names,
            gate,
        })
    }

    fn engine(&mut self) -> Result<&mut Weavatrix, Error> {
        if self.engine.is_none() {
            let engine = Weavatrix::open(&self.root)?;
            engine.state().warm_communities();
            self.engine = Some(engine);
        }
        self.engine
            .as_mut()
            .ok_or_else(|| Error::InvalidRepository(self.root.clone()))
    }

    fn refresh(&mut self) -> Result<bool, String> {
        let engine = self
            .engine
            .as_mut()
            .ok_or_else(|| "repository graph is not initialized".to_owned())?;
        let refreshed = engine
            .refresh_if_stale()
            .map_err(|error| format!("repository refresh failed: {error}"))?;
        if refreshed {
            engine.state().warm_communities();
        }
        Ok(refreshed)
    }

    /// Refuses a write before the operation runs, so a closed gate can never reach an engine
    /// that would otherwise touch the working tree.
    fn refuse_closed_gate(&self, name: &str) -> Option<Value> {
        let writes = refactor::Operation::from_name(name).is_some_and(refactor::Operation::writes);
        if !writes || self.gate.is_open() {
            return None;
        }
        Some(json!({
            "status": "WRITE_GATE_CLOSED",
            "operation": name,
            "gate": WriteGate::VARIABLE,
            "reason": format!(
                "the server was started without {}=1. Opening the write gate is a deliberate user \
                 choice: preview and every read-only analysis stay available while it is closed.",
                WriteGate::VARIABLE
            ),
        }))
    }
}

impl RepositoryPort for RefactorRepository {
    fn root(&self) -> &Path {
        &self.root
    }

    fn is_loaded(&self) -> bool {
        self.engine.is_some()
    }

    fn ensure_loaded(&mut self) -> Result<(), String> {
        self.engine().map(|_| ()).map_err(|error| error.to_string())
    }

    fn refresh_if_stale(&mut self) -> Result<bool, String> {
        self.refresh()
    }

    fn call(&mut self, name: &str, arguments: Value) -> Result<Value, String> {
        if self.refactor_names.contains(name) {
            if let Some(refusal) = self.refuse_closed_gate(name) {
                return Ok(refusal);
            }
            let engine = self.engine().map_err(|error| error.to_string())?;
            return refactor::call(engine.state(), name, &arguments);
        }
        let engine = self.engine().map_err(|error| error.to_string())?;
        let result = operations::call(engine, name, arguments);
        if result.is_ok() && name == "open_repo" {
            self.root = self
                .engine()
                .map_err(|error| error.to_string())?
                .state()
                .root()
                .to_path_buf();
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::ToolCatalog;
    use weavatrix_rust_refactor::operations as refactor;

    #[test]
    fn the_merged_catalog_carries_both_halves_without_collision() {
        let catalog = ToolCatalog::merged().expect("catalogs must merge");
        for name in refactor::catalog_names() {
            assert!(
                catalog.names.contains(&name),
                "{name} missing from the merged catalog"
            );
            assert!(catalog.refactor_names.contains(&name));
        }
        assert!(
            catalog.names.contains("graph_stats"),
            "read-only tools must survive the merge"
        );
        let encoded = catalog.encoded.as_array().expect("catalog is an array");
        assert_eq!(encoded.len(), catalog.names.len());
    }

    #[test]
    fn the_refactor_half_is_exactly_eleven_tools() {
        let catalog = ToolCatalog::merged().expect("catalogs must merge");
        assert_eq!(catalog.refactor_names.len(), 11);
    }
}
