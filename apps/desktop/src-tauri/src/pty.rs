use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
}

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    agent_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PtyInfo {
    pub pty_id: String,
    pub agent_id: String,
    pub command: String,
    pub pid: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct SpawnPtyArgs {
    pub agent_id: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub rows: Option<u16>,
    #[serde(default)]
    pub cols: Option<u16>,
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyManager>,
    args: SpawnPtyArgs,
) -> Result<String, String> {
    let pty_id = format!("pty_{}_{}", args.agent_id, std::process::id());
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: args.rows.unwrap_or(24),
            cols: args.cols.unwrap_or(80),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty failed: {e}"))?;

    let mut cmd = CommandBuilder::new(&args.command);
    cmd.args(&args.args);
    for (k, v) in std::env::vars() {
        cmd.env(k, v);
    }
    for (k, v) in &args.env {
        cmd.env(k, v);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn failed: {e}"))?;
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone_reader failed: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take_writer failed: {e}"))?;

    {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.insert(
            pty_id.clone(),
            PtySession {
                master: pair.master,
                writer,
                child,
                agent_id: args.agent_id.clone(),
            },
        );
    }

    // Background reader thread pushes output as Tauri events
    let app_clone = app.clone();
    let pty_id_clone = pty_id.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_clone.emit(
                        "pty:data",
                        serde_json::json!({ "ptyId": pty_id_clone, "data": data }),
                    );
                }
                Err(_) => break,
            }
        }
        let _ = app_clone.emit(
            "pty:exit",
            serde_json::json!({ "ptyId": pty_id_clone, "exitCode": null }),
        );
    });

    Ok(pty_id)
}

#[tauri::command]
pub fn pty_write(
    state: State<'_, PtyManager>,
    pty_id: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    let session = sessions.get_mut(&pty_id).ok_or("unknown pty_id")?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn pty_resize(
    state: State<'_, PtyManager>,
    pty_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();
    let session = sessions.get(&pty_id).ok_or("unknown pty_id")?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn pty_kill(state: State<'_, PtyManager>, pty_id: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(mut session) = sessions.remove(&pty_id) {
        let _ = session.child.kill();
    }
    Ok(())
}

#[tauri::command]
pub fn pty_list(state: State<'_, PtyManager>) -> Result<Vec<PtyInfo>, String> {
    let sessions = state.sessions.lock().unwrap();
    let infos: Vec<PtyInfo> = sessions
        .iter()
        .map(|(id, s)| PtyInfo {
            pty_id: id.clone(),
            agent_id: s.agent_id.clone(),
            command: "unknown".to_string(),
            pid: s.child.process_id(),
        })
        .collect();
    Ok(infos)
}
