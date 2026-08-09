use crate::mcp::ports::{ChangeMonitor, ChangeMonitorFactory};
use notify::{EventKind, RecursiveMode, Watcher};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, TryRecvError};
use weavatrix_rust::Analyzer;

const DERIVED_DIRECTORIES: &[&str] = &[
    ".git",
    ".weavatrix",
    ".codegraph",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".turbo",
    ".venv",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "target",
    "vendor",
];

pub(crate) struct NotifyMonitorFactory;

impl ChangeMonitorFactory for NotifyMonitorFactory {
    fn create(&self, root: &Path) -> io::Result<Box<dyn ChangeMonitor>> {
        RepositoryWatcher::new(root).map(|watcher| Box::new(watcher) as Box<dyn ChangeMonitor>)
    }
}

struct RepositoryWatcher {
    root: PathBuf,
    _watcher: notify::RecommendedWatcher,
    events: Receiver<notify::Result<notify::Event>>,
}

impl RepositoryWatcher {
    fn new(root: &Path) -> io::Result<Self> {
        let root = root.canonicalize()?;
        let (sender, events) = mpsc::channel();
        let mut watcher = notify::recommended_watcher(move |event| {
            let _ = sender.send(event);
        })
        .map_err(io::Error::other)?;
        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(io::Error::other)?;
        Ok(Self {
            root,
            _watcher: watcher,
            events,
        })
    }
}

impl ChangeMonitor for RepositoryWatcher {
    fn changed(&self) -> io::Result<bool> {
        let mut changed = false;
        loop {
            match self.events.try_recv() {
                Ok(Ok(event)) => {
                    if event_affects_analysis(&self.root, &event) {
                        changed = true;
                    }
                }
                Ok(Err(error)) => return Err(io::Error::other(error)),
                Err(TryRecvError::Empty) => return Ok(changed),
                Err(TryRecvError::Disconnected) => {
                    return Err(io::Error::new(
                        io::ErrorKind::BrokenPipe,
                        "repository filesystem watcher disconnected",
                    ));
                }
            }
        }
    }
}

fn event_affects_analysis(root: &Path, event: &notify::Event) -> bool {
    !matches!(event.kind, EventKind::Access(_))
        && event
            .paths
            .iter()
            .any(|path| analysis_input_changed(root, path))
}

fn analysis_input_changed(root: &Path, path: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(root) else {
        return false;
    };
    let normalized = relative.to_string_lossy().replace('\\', "/");
    let lower = normalized.to_ascii_lowercase();
    let file_name = relative
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if is_ignore_configuration(&file_name, &lower) {
        return true;
    }
    if lower
        .split('/')
        .any(|component| DERIVED_DIRECTORIES.contains(&component))
    {
        return false;
    }
    Analyzer::default().supports_path(&normalized)
}

fn is_ignore_configuration(file_name: &str, relative_path: &str) -> bool {
    matches!(file_name, ".gitignore" | ".ignore" | ".weavatrixignore")
        || matches!(relative_path, ".git/config" | ".git/info/exclude")
}
