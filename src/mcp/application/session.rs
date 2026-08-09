use crate::mcp::ports::{ChangeMonitor, ChangeMonitorFactory, RepositoryPort};
use blazingly_json::Value;
use std::io;
use std::sync::Arc;
use std::sync::mpsc::{self, Receiver};

type PendingMonitor = Receiver<io::Result<Box<dyn ChangeMonitor>>>;

enum MonitorState {
    NotStarted,
    Starting(PendingMonitor),
    Ready(Box<dyn ChangeMonitor>),
}

pub(crate) struct RepositorySession {
    repository: Box<dyn RepositoryPort>,
    monitor_factory: Arc<dyn ChangeMonitorFactory>,
    first_tool_call: bool,
    monitor: MonitorState,
}

impl RepositorySession {
    pub(crate) fn new(
        repository: Box<dyn RepositoryPort>,
        monitor_factory: Arc<dyn ChangeMonitorFactory>,
    ) -> Self {
        Self {
            repository,
            monitor_factory,
            first_tool_call: true,
            monitor: MonitorState::NotStarted,
        }
    }

    pub(crate) fn call(&mut self, name: &str, arguments: Value) -> Result<Value, String> {
        let graph_was_loaded = self.repository.is_loaded();
        let first_tool_call = self.first_tool_call;
        self.refresh_for_call(name, first_tool_call, graph_was_loaded)?;
        self.repository
            .ensure_loaded()
            .map_err(|error| format!("repository initialization failed: {error}"))?;

        let result = self.repository.call(name, arguments);
        let opened_repository = result.is_ok() && name == "open_repo";
        if (first_tool_call || !graph_was_loaded || opened_repository)
            && self.repository.is_loaded()
        {
            self.start_monitor()
                .map_err(|error| format!("repository watcher startup failed: {error}"))?;
        }
        self.first_tool_call = false;
        result
    }

    fn refresh_for_call(
        &mut self,
        name: &str,
        first_tool_call: bool,
        graph_was_loaded: bool,
    ) -> Result<(), String> {
        if first_tool_call {
            self.refresh_repository()
        } else if graph_was_loaded && !matches!(name, "rebuild_graph" | "open_repo") {
            self.refresh_from_monitor()
        } else {
            Ok(())
        }
    }

    fn refresh_repository(&mut self) -> Result<(), String> {
        self.repository.refresh_if_stale().map(|_| ())
    }

    fn start_monitor(&mut self) -> io::Result<()> {
        let root = self.repository.root().to_path_buf();
        let factory = Arc::clone(&self.monitor_factory);
        let (sender, receiver) = mpsc::sync_channel(1);
        std::thread::Builder::new()
            .name("weavatrix-watch-init".to_owned())
            .spawn(move || {
                let _ = sender.send(factory.create(&root));
            })?;
        self.monitor = MonitorState::Starting(receiver);
        Ok(())
    }

    fn refresh_from_monitor(&mut self) -> Result<(), String> {
        let (monitor, _catch_up) = self.take_ready_monitor()?;
        self.monitor = MonitorState::Ready(monitor);
        let _queued_change = self.monitor_changed()?;
        // Watcher events are only a latency hint: filesystem backends may coalesce or
        // miss them.  The repository revision check is the source of truth for every
        // tool call, so a quiet watcher must never leave the graph stale.
        self.refresh_repository()?;
        if self.monitor_changed()? {
            self.refresh_repository()?;
        }
        Ok(())
    }

    fn take_ready_monitor(&mut self) -> Result<(Box<dyn ChangeMonitor>, bool), String> {
        let state = std::mem::replace(&mut self.monitor, MonitorState::NotStarted);
        match state {
            MonitorState::NotStarted => self
                .monitor_factory
                .create(self.repository.root())
                .map(|monitor| (monitor, true))
                .map_err(|error| watcher_error(&error)),
            MonitorState::Starting(receiver) => receiver
                .recv()
                .map_err(|_| "repository watcher startup disconnected".to_owned())?
                .map(|monitor| (monitor, true))
                .map_err(|error| watcher_error(&error)),
            MonitorState::Ready(monitor) => Ok((monitor, false)),
        }
    }

    fn monitor_changed(&self) -> Result<bool, String> {
        match &self.monitor {
            MonitorState::Ready(monitor) => {
                monitor.changed().map_err(|error| watcher_error(&error))
            }
            MonitorState::NotStarted | MonitorState::Starting(_) => {
                Err("repository watcher failed: repository watcher is not ready".to_owned())
            }
        }
    }
}

fn watcher_error(error: &io::Error) -> String {
    format!("repository watcher failed: {error}")
}
