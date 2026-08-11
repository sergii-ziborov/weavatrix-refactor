use crate::mcp::McpError;
use crate::mcp::adapters::{NotifyMonitorFactory, RefactorRepository, ToolCatalog, ToolSurface};
use crate::mcp::application::RepositorySession;
use crate::write_gate::WriteGate;
use mcport::{ServerIdentity, ToolPayload, ToolReply, ToolServer, Value};
use std::path::Path;
use std::sync::Arc;

/// The refactor tool surface behind the shared `mcport` stdio runtime.
///
/// One process answers both halves: every read-only operation of the engine and the eleven
/// refactor tools. That is the point of merging them here rather than proxying a second server —
/// a refactor session stays in one evidence chain, on one graph revision, without a second
/// process to keep in step.
struct RefactorServer {
    identity: ServerIdentity,
    catalog: Value,
    tool_names: std::collections::BTreeSet<String>,
    session: RepositorySession,
}

impl RefactorServer {
    #[cfg(test)]
    fn new(root: impl AsRef<Path>, gate: WriteGate) -> Result<Self, McpError> {
        Self::new_for_surface(root, gate, ToolSurface::Full)
    }

    fn new_for_surface(
        root: impl AsRef<Path>,
        gate: WriteGate,
        surface: ToolSurface,
    ) -> Result<Self, McpError> {
        let catalog = ToolCatalog::for_surface(surface)?;
        let instructions = match surface {
            ToolSurface::Full => {
                "Local repository intelligence with proven refactoring. Writes require an explicit \
                 gate and a plan-bound single-use token."
            }
            ToolSurface::Rename => {
                "Rename-only workflow. Start with the bare symbol name; if it is ambiguous, retry \
                 rename_symbol with one candidate id. Do not invent a symbol id. Preview the exact \
                 candidate, then repeat the identical symbol and new_name with mode=apply and its \
                 confirm_token. rollback_last_apply is the recovery tool."
            }
        };
        let repository = RefactorRepository::open(
            root.as_ref().to_path_buf(),
            catalog.refactor_names.clone(),
            gate,
        )?;
        Ok(Self {
            identity: ServerIdentity::new(
                "weavatrix-refactor",
                env!("CARGO_PKG_VERSION"),
                instructions,
            ),
            catalog: catalog.encoded,
            tool_names: catalog.names,
            session: RepositorySession::new(Box::new(repository), Arc::new(NotifyMonitorFactory)),
        })
    }
}

impl ToolServer for RefactorServer {
    fn identity(&self) -> ServerIdentity {
        self.identity.clone()
    }

    fn identity_ref(&self) -> Option<&ServerIdentity> {
        Some(&self.identity)
    }

    fn catalog(&mut self) -> Value {
        self.catalog.clone()
    }

    fn catalog_ref(&mut self) -> Option<&Value> {
        Some(&self.catalog)
    }

    fn has_tool(&self, name: &str) -> Option<bool> {
        Some(self.tool_names.contains(name))
    }

    fn call(&mut self, name: &str, arguments: Value) -> ToolReply {
        if !self.tool_names.contains(name) {
            return ToolReply::error(format!("tool `{name}` is not exposed by this MCP profile"));
        }
        // `Mirrored` rather than `Structured`: it carries structuredContent *and* the text
        // mirror, which is what the old boolean did. Dropping the mirror would show an empty
        // result to any client that reads only `content`.
        let payload = if arguments
            .get("output_format")
            .and_then(Value::as_str)
            .is_none_or(|format| format == "json")
        {
            ToolPayload::Mirrored
        } else {
            ToolPayload::Text
        };
        match self.session.call(name, arguments) {
            Ok(value) => ToolReply::Success { value, payload },
            Err(error) => ToolReply::error(error),
        }
    }
}

/// Serves the merged read-only and refactor surface over one stdio runtime.
///
/// The repository root and graph are validated eagerly so misconfiguration fails before the
/// protocol handshake, and the write gate is read once at startup rather than per call.
///
/// # Errors
///
/// Returns stdio failures or a missing repository root.
pub(crate) fn serve_with_surface(
    root: impl AsRef<Path>,
    gate: WriteGate,
    surface: ToolSurface,
) -> Result<(), McpError> {
    let root = root.as_ref();
    if !root.is_dir() {
        return Err(McpError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("repository root {} is not a directory", root.display()),
        )));
    }
    let mut server = RefactorServer::new_for_surface(root, gate, surface)?;
    mcport::serve(&mut server).map_err(McpError::Io)
}

#[cfg(test)]
mod tests;
