use super::RefactorServer;
use crate::mcp::adapters::ToolSurface;
use crate::write_gate::WriteGate;
use mcport::{ToolReply, ToolServer};
use std::fs;

/// A repository of its own for each test.
///
/// Keyed on the process id alone this was one directory shared by every test in the binary, and
/// the tests in a binary run in parallel: each call wiped the tree another test was still
/// reading. It passed here and on Linux and failed on Windows and macOS, which is what that
/// class of bug looks like from the outside. The counter is what makes them independent.
fn fixture() -> std::path::PathBuf {
    use std::sync::atomic::{AtomicU32, Ordering};
    static NEXT: AtomicU32 = AtomicU32::new(0);
    let root = std::env::temp_dir().join(format!(
        "wvxr-host-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
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
fn the_rename_profile_hides_every_unrelated_tool() {
    let mut server =
        RefactorServer::new_for_surface(fixture(), WriteGate::closed(), ToolSurface::Rename)
            .expect("server");
    let tools = server
        .catalog()
        .as_array()
        .expect("catalog is an array")
        .clone();
    let names = tools
        .iter()
        .filter_map(|tool| tool.get("name").and_then(blazingly_json::Value::as_str))
        .collect::<Vec<_>>();
    assert_eq!(names, ["rename_symbol", "rollback_last_apply"]);
    assert_eq!(server.has_tool("graph_stats"), Some(false));
    assert!(!matches!(
        server.call("graph_stats", blazingly_json::json!({})),
        ToolReply::Success { .. }
    ));
    let instructions = server.identity().instructions;
    assert!(instructions.contains("Start with the bare symbol name"));
    assert!(instructions.contains("Do not invent a symbol id"));
}

#[test]
fn a_closed_gate_refuses_every_writing_tool_and_no_reading_one() {
    let mut server = RefactorServer::new(fixture(), WriteGate::closed()).expect("server");
    for (name, arguments) in [
        (
            "rename_symbol",
            blazingly_json::json!({"symbol": "one", "new_name": "two"}),
        ),
        (
            "rename_related_symbols",
            blazingly_json::json!({"renames": []}),
        ),
        ("apply_edit_plan", blazingly_json::json!({})),
    ] {
        let reply = server.call(name, arguments);
        assert_ne!(
            status_of(&reply),
            "WRITE_GATE_CLOSED",
            "{name} preview is a read and must reach the engine"
        );
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
    let apply = server.call(
        "apply_edit_plan",
        blazingly_json::json!({"mode": "apply", "confirm_token": "unissued"}),
    );
    assert_eq!(status_of(&apply), "WRITE_GATE_CLOSED");
    let rollback = server.call("rollback_last_apply", blazingly_json::json!({}));
    assert_eq!(status_of(&rollback), "WRITE_GATE_CLOSED");
}

#[test]
fn the_linked_refactor_engine_supports_same_method_rename_preview_and_apply() {
    use blazingly_json::Value;
    use weavatrix_rust::Weavatrix;
    use weavatrix_rust_refactor::operations::RefactorSession;

    let root = fixture();
    let engine = Weavatrix::open(&root).expect("repository opens");
    let state = engine.state().clone();
    let Some(id) = state
        .graph()
        .nodes()
        .iter()
        .find(|node| node.label.starts_with("one"))
        .map(|node| node.id.as_str().to_owned())
    else {
        panic!("fixture symbol must be indexed");
    };
    let session = RefactorSession::new(true);
    let preview = session
        .call(
            &state,
            "rename_symbol",
            &blazingly_json::json!({"symbol": id.clone(), "new_name": "two"}),
        )
        .expect("declared tool");
    let Some(token) = preview.get("confirmToken").and_then(Value::as_str) else {
        panic!("rename must preview its own plan: {preview:?}");
    };
    let applied = session
        .call(
            &state,
            "rename_symbol",
            &blazingly_json::json!({
                "symbol": id,
                "new_name": "two",
                "mode": "apply",
                "confirm_token": token.to_owned(),
            }),
        )
        .expect("declared tool");
    assert_eq!(
        applied.get("status").and_then(Value::as_str),
        Some("APPLIED"),
        "{applied:?}"
    );
    assert!(
        fs::read_to_string(root.join("src/lib.rs"))
            .expect("source")
            .contains("fn two()")
    );
}

#[test]
fn identity_names_the_refactor_host_and_its_own_version() {
    let server = RefactorServer::new(fixture(), WriteGate::closed()).expect("server");
    let identity = server.identity();
    assert_eq!(identity.name, "weavatrix-refactor");
    assert_eq!(identity.version, env!("CARGO_PKG_VERSION"));
}

#[test]
fn registry_manifest_advertises_only_environment_variables_the_native_host_reads() {
    let manifest: blazingly_json::Value =
        blazingly_json::from_str(include_str!("../../../server.json")).expect("server manifest");
    let names = manifest
        .get("packages")
        .and_then(blazingly_json::Value::as_array)
        .and_then(|packages| packages.first())
        .and_then(|package| package.get("environmentVariables"))
        .and_then(blazingly_json::Value::as_array)
        .expect("environment variable declarations")
        .iter()
        .filter_map(|variable| variable.get("name"))
        .filter_map(blazingly_json::Value::as_str)
        .collect::<Vec<_>>();
    assert_eq!(names, ["WEAVATRIX_ALLOW_SOURCE_EDITS"]);
}
