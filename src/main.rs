mod mcp;
mod write_gate;

use std::env;
use std::process::ExitCode;
use weavatrix_rust::{Weavatrix, operations};
use weavatrix_rust_refactor::operations as refactor;
use write_gate::WriteGate;

fn main() -> ExitCode {
    let arguments = env::args().skip(1).collect::<Vec<_>>();
    match run(&arguments) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("weavatrix-refactor: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(arguments: &[String]) -> Result<(), String> {
    match arguments.first().map(String::as_str) {
        Some("--version") => {
            println!(
                "weavatrix-refactor {} (engine {}, refactor {}, contract v{})",
                env!("CARGO_PKG_VERSION"),
                weavatrix_rust::VERSION,
                weavatrix_rust_refactor::VERSION,
                weavatrix_rust_refactor::CONTRACT_VERSION
            );
            Ok(())
        }
        Some("--help" | "-h") => {
            print_help();
            Ok(())
        }
        Some("mcp") => serve_mcp(arguments),
        Some("list-tools") => list_tools(),
        Some("tool") => call_tool(arguments),
        _ => {
            print_help();
            Err("expected the `mcp`, `tool`, or `list-tools` command".into())
        }
    }
}

fn serve_mcp(arguments: &[String]) -> Result<(), String> {
    let mut repository = ".";
    for argument in arguments.iter().skip(1) {
        if argument.starts_with('-') {
            return Err(format!("unknown MCP option: {argument}"));
        }
        repository = argument;
    }
    mcp::serve(repository, WriteGate::from_environment()).map_err(|error| error.to_string())
}

fn list_tools() -> Result<(), String> {
    let mut catalog = blazingly_json::to_value(operations::catalog_for_profile(
        operations::ToolProfile::All,
    ))
    .map_err(|error| error.to_string())?
    .as_array()
    .cloned()
    .unwrap_or_default();
    if let Some(tools) = refactor::catalog().as_array() {
        catalog.extend(tools.iter().cloned());
    }
    println!(
        "{}",
        blazingly_json::to_string_pretty(&blazingly_json::Value::Array(catalog))
            .map_err(|error| error.to_string())?
    );
    Ok(())
}

/// Calls one tool from the command line.
///
/// The write gate applies here exactly as it does over MCP: a refactoring tool that would write
/// refuses unless the environment opened it. A CLI is not a way around a safety boundary.
fn call_tool(arguments: &[String]) -> Result<(), String> {
    let name = arguments
        .get(1)
        .ok_or_else(|| "tool requires an operation name".to_owned())?;
    let repository = arguments.get(2).map_or(".", String::as_str);
    let input = arguments
        .get(3)
        .map_or_else(
            || Ok(blazingly_json::json!({})),
            |value| blazingly_json::from_str(value),
        )
        .map_err(|error| format!("invalid operation JSON: {error}"))?;

    let output = if refactor::Operation::from_name(name).is_some() {
        let writes = refactor::Operation::from_name(name).is_some_and(refactor::Operation::writes);
        if writes && !WriteGate::from_environment().is_open() {
            blazingly_json::json!({
                "status": "WRITE_GATE_CLOSED",
                "operation": name,
                "gate": WriteGate::VARIABLE,
                "reason": format!("set {}=1 to allow source edits", WriteGate::VARIABLE),
            })
        } else {
            refactor::call(name, &input)?
        }
    } else {
        let mut engine = Weavatrix::open(repository).map_err(|error| error.to_string())?;
        operations::call(&mut engine, name, input)?
    };
    println!(
        "{}",
        blazingly_json::to_string_pretty(&output).map_err(|error| error.to_string())?
    );
    Ok(())
}

fn print_help() {
    println!(
        "Weavatrix Refactor: repository intelligence with proven, transactional refactoring\n\n\
Usage:\n  weavatrix-refactor mcp [REPOSITORY]\n\
  weavatrix-refactor list-tools\n\
  weavatrix-refactor tool NAME [REPOSITORY] ['{{\"argument\":\"value\"}}']\n\
  weavatrix-refactor --version\n\n\
Source edits additionally require {}=1 and a plan-bound single-use token.",
        WriteGate::VARIABLE
    );
}
