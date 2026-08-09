use std::fmt::{Display, Formatter};
use std::io;
use weavatrix_rust::Error;

#[derive(Debug)]
pub enum McpError {
    Io(io::Error),
    Repository(Error),
}

impl Display for McpError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "MCP I/O failed: {error}"),
            Self::Repository(error) => {
                write!(formatter, "repository initialization failed: {error}")
            }
        }
    }
}

impl std::error::Error for McpError {}

impl From<io::Error> for McpError {
    fn from(value: io::Error) -> Self {
        Self::Io(value)
    }
}

impl From<Error> for McpError {
    fn from(value: Error) -> Self {
        Self::Repository(value)
    }
}
