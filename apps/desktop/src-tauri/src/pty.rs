// PTY Manager — pseudo-terminal support for embedded CLI agent shells.
//
// Uses portable-pty to create a real PTY, spawn the configured CLI agent,
// and bridge I/O between the PTY and the frontend via Tauri IPC.

use portable_pty::{CommandBuilder, PtySize, native_pty_system, MasterPty};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::State;

// ── PTY Session ──────────────────────────────────────────────────

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    reader: Box<dyn Read + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    agent_id: String,
}

// ── PTY Manager ──────────────────────────────────────────────────

pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    fn spawn_pty(
        &self,
        agent_id: &str,
        command: &str,
        args: &[String],
        rows: u16,
        cols: u16,
    ) -> Result<(), String> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let mut cmd = CommandBuilder::new(command);
        cmd.args(args);
        for (key, value) in std::env::vars() {
            cmd.env(key, value);
        }
        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn agent process: {}", e))?;

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone reader: {}", e))?;
        let writer = pair.master.take_writer().map_err(|e| format!("Failed to get writer: {}", e))?;

        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        sessions.insert(
            agent_id.to_string(),
            PtySession {
                master: pair.master,
                reader,
                writer,
                child,
                agent_id: agent_id.to_string(),
            },
        );

        Ok(())
    }

    fn write_to(&self, agent_id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let session = sessions
            .get_mut(agent_id)
            .ok_or_else(|| format!("No PTY session for agent: {}", agent_id))?;
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("PTY write failed: {}", e))?;
        session.writer.flush().map_err(|e| format!("PTY flush failed: {}", e))?;
        Ok(())
    }

    fn resize(&self, agent_id: &str, rows: u16, cols: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let session = sessions
            .get(agent_id)
            .ok_or_else(|| format!("No PTY session for agent: {}", agent_id))?;
        session
            .master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("PTY resize failed: {}", e))?;
        Ok(())
    }

    fn kill(&self, agent_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        sessions.remove(agent_id);
        Ok(())
    }

    fn try_read(&self, agent_id: &str) -> Result<String, String> {
        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let session = sessions
            .get_mut(agent_id)
            .ok_or_else(|| format!("No PTY session for agent: {}", agent_id))?;

        let mut buf = [0u8; 4096];
        match session.reader.read(&mut buf) {
            Ok(n) if n > 0 => Ok(String::from_utf8_lossy(&buf[..n]).to_string()),
            Ok(_) => Ok(String::new()),
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => Ok(String::new()),
            Err(e) => Err(format!("PTY read error: {}", e)),
        }
    }
}

// ── Tauri Commands ────────────────────────────────────────────────

#[tauri::command]
pub fn pty_spawn(
    state: State<PtyManager>,
    agent_id: String,
    command: String,
    args: Vec<String>,
    rows: Option<u16>,
    cols: Option<u16>,
) -> Result<(), String> {
    state.spawn_pty(&agent_id, &command, &args, rows.unwrap_or(24), cols.unwrap_or(80))
}

#[tauri::command]
pub fn pty_write(state: State<PtyManager>, agent_id: String, data: String) -> Result<(), String> {
    state.write_to(&agent_id, &data)
}

#[tauri::command]
pub fn pty_resize(state: State<PtyManager>, agent_id: String, rows: u16, cols: u16) -> Result<(), String> {
    state.resize(&agent_id, rows, cols)
}

#[tauri::command]
pub fn pty_kill(state: State<PtyManager>, agent_id: String) -> Result<(), String> {
    state.kill(&agent_id)
}

#[tauri::command]
pub fn pty_read(state: State<PtyManager>, agent_id: String) -> Result<String, String> {
    state.try_read(&agent_id)
}
