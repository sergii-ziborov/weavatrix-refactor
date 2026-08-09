use super::RefactorServer;
use crate::write_gate::WriteGate;
use mcport::{ToolReply, ToolServer};
use std::fs;

fn fixture() -> std::path::PathBuf {
    let root = std::env::temp_dir().join(format!("wvxr-host-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(root.join("src")).expect("fixture root");
    fs::write(root.join("src/lib.rs"), "pub fn one() -> u32 { 1 }\n").expect("fixture source");
    root
}

fn status_of(reply: &ToolReply) -> String {
    match reply {
        ToolReply::Success { value, .. } => value
            .get("status")
            .and_then(|status| status.as_str())
            .unwrap_or_default()
            .to_owned(),
        // Every other reply shape is a failure to answer with a status, which is what these
        // tests are checking against; naming them separately would not make that clearer.
        _ => "NO_STATUS".to_owned(),
    }
}

#[test]
fn the_catalog_exposes_the_read_only_engine_and_all_eleven_refactor_tools() {
    let mut server = RefactorServer::new(fixture(), WriteGate::closed()).expect("server");
    let catalog = server.catalog();
    let tools = catalog.as_array().expect("catalog is an array");
    assert!(tools.len() > 11, "the read-only half must be present too");
    for name in weavatrix_rust_refactor::operations::catalog_names() {
        assert_eq!(server.has_tool(&name), Some(true), "{name} is not exposed");
    }
    assert_eq!(server.has_tool("graph_stats"), Some(true));
    assert_eq!(server.has_tool("reformat_universe"), Some(false));
}

#[test]
fn a_closed_gate_refuses_every_writing_tool_and_no_reading_one() {
    let mut server = RefactorServer::new(fixture(), WriteGate::closed()).expect("server");
    for name in [
        "rename_symbol",
        "rename_related_symbols",
        "apply_edit_plan",
        "rollback_last_apply",
    ] {
        let reply = server.call(name, blazingly_json::json!({}));
        assert_eq!(status_of(&reply), "WRITE_GATE_CLOSED", "{name} must refuse");
    }
    for name in [
        "delete_readiness",
        "move_symbol",
        "bulk_replace",
        "organize_imports",
    ] {
        let reply = server.call(name, blazingly_json::json!({}));
        assert_ne!(
            status_of(&reply),
            "WRITE_GATE_CLOSED",
            "{name} is a read and must not refuse"
        );
    }
}

#[test]
fn identity_names_the_refactor_host_and_its_own_version() {
    let server = RefactorServer::new(fixture(), WriteGate::closed()).expect("server");
    let identity = server.identity();
    assert_eq!(identity.name, "weavatrix-refactor");
    assert_eq!(identity.version, env!("CARGO_PKG_VERSION"));
}
