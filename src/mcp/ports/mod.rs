use blazingly_json::Value;
use std::io;
use std::path::Path;

pub(crate) trait RepositoryPort {
    fn root(&self) -> &Path;

    fn is_loaded(&self) -> bool;

    fn ensure_loaded(&mut self) -> Result<(), String>;

    fn refresh_if_stale(&mut self) -> Result<bool, String>;

    fn call(&mut self, name: &str, arguments: Value) -> Result<Value, String>;
}

pub(crate) trait ChangeMonitor: Send {
    fn changed(&self) -> io::Result<bool>;
}

pub(crate) trait ChangeMonitorFactory: Send + Sync {
    fn create(&self, root: &Path) -> io::Result<Box<dyn ChangeMonitor>>;
}
