mod adapters;
mod application;
mod error;
mod ports;
mod server;

pub use error::McpError;
pub use server::serve;
