mod pty;

use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::path::PathBuf;
use pty::PtyManager;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

struct ServerProcess(Arc<Mutex<Option<Child>>>);

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Cabinet.", name)
}

#[tauri::command]
fn minimize(window: tauri::Window) {
    let _ = window.minimize();
}

#[tauri::command]
fn maximize(window: tauri::Window) {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
}

#[tauri::command]
fn close(window: tauri::Window) {
    let _ = window.close();
}

#[tauri::command]
fn is_maximized(window: tauri::Window) -> bool {
    window.is_maximized().unwrap_or(false)
}

#[tauri::command]
fn open_devtools(app: tauri::AppHandle) {
    if let Some(webview) = app.get_webview_window("main") {
        webview.open_devtools();
    }
}

fn is_port_3000_alive() -> bool {
    // If a server is already running on port 3000, reuse it — no need to kill
    std::net::TcpStream::connect("127.0.0.1:3000").is_ok()
}

fn find_node(exe_dir: &std::path::Path) -> Option<PathBuf> {
    // 1) Bundled portable Node.js (production)
    let bundled = exe_dir.join("resources").join("node-portable.exe");
    log(&format!("Checking bundled node: {}", bundled.display()));
    if bundled.exists() {
        log("Bundled node found!");
        return Some(bundled);
    }

    // 2) System Node.js (development fallback)
    let candidates = [
        "node.exe",
        "C:\\Program Files\\nodejs\\node.exe",
        "C:\\nvm4w\\nodejs\\node.exe",
        &format!("{}\\nodejs\\node.exe", std::env::var("ProgramFiles").unwrap_or_default().replace(" (x86)", "")),
    ];
    for c in &candidates {
        if let Ok(output) = Command::new(c).arg("--version").output() {
            if output.status.success() {
                log(&format!("Found system node at: {}", c));
                return Some(PathBuf::from(c));
            }
        }
    }
    // Bare name fallback
    if let Ok(output) = Command::new("node").arg("--version").output() {
        if output.status.success() {
            log("Found system node via PATH");
            return Some(PathBuf::from("node"));
        }
    }
    None
}

fn log(msg: &str) {
    use std::io::Write;
    let log_path = std::env::temp_dir().join("cabinet-startup.log");
    let line = format!("{}\n", msg);
    let _ = std::fs::OpenOptions::new().create(true).append(true).open(&log_path)
        .and_then(|mut f| {
            f.write_all(line.as_bytes())?;
            f.flush()
        });
}

fn find_server_script(exe_dir: &std::path::Path) -> Option<PathBuf> {
    // 1) Bundled server (production): {exe_dir}/resources/server-dist/main.cjs
    let bundled = exe_dir.join("resources").join("server-dist").join("main.cjs");
    log(&format!("Checking bundled server: {}", bundled.display()));
    if bundled.exists() {
        log("Bundled server found!");
        return Some(bundled);
    }

    // 2) Development: 4 levels up from target/release to apps/, then server/dist/main.js
    let dev_dist = exe_dir.join("..").join("..").join("..").join("..").join("server").join("dist").join("main.js");
    log(&format!("Checking dev path: {}", dev_dist.display()));
    if dev_dist.exists() {
        if let Ok(canon) = dev_dist.canonicalize() {
            log(&format!("Canonicalized: {}", canon.display()));
            return Some(canon);
        } else {
            log("Canonicalize FAILED");
        }
    }

    log("No server script found!");
    None
}

fn ensure_cabinet_dir() {
    let home = match dirs_next::home_dir() {
        Some(h) => h,
        None => {
            log("WARNING: Could not determine home directory, skipping .cabinet creation");
            return;
        }
    };
    let cabinet = home.join(".cabinet");
    if !cabinet.exists() {
        log(&format!("Creating ~/.cabinet at {}", cabinet.display()));
        let _ = std::fs::create_dir_all(&cabinet);
    }
    let subdirs = ["agents", "skills", "mcp", "projects", "plugins", "sessions", "plans", "backups", "logs", "rules"];
    for sub in &subdirs {
        let dir = cabinet.join(sub);
        if !dir.exists() {
            let _ = std::fs::create_dir_all(&dir);
        }
    }
}

fn start_server() -> Option<Child> {
    log("start_server() called");

    // Ensure ~/.cabinet/ exists before starting the server
    ensure_cabinet_dir();

    // If a server is already running, reuse it
    if is_port_3000_alive() {
        log("Port 3000 already alive — reusing existing server");
        return None;
    }

    let exe_dir = match std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())) {
        Some(d) => { log(&format!("exe_dir: {}", d.display())); d }
        None => { log("Failed to get exe_dir!"); return None; }
    };

    let node = match find_node(&exe_dir) {
        Some(n) => { log(&format!("Found node: {}", n.display())); n }
        None => { log("find_node() returned None!"); return None; }
    };

    let server_script = match find_server_script(&exe_dir) {
        Some(s) => { log(&format!("Found server script: {}", s.display())); s }
        None => { log("find_server_script() returned None!"); return None; }
    };

    let server_dir = server_script.parent().unwrap_or(&exe_dir);
    log(&format!("Spawning: {} {} (cwd: {})", node.display(), server_script.display(), server_dir.display()));

    let mut cmd = Command::new(&node);
    cmd.arg(&server_script).current_dir(server_dir);
    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    match cmd.spawn()
    {
        Ok(child) => {
            log(&format!("Server started (pid: {})", child.id()));
            Some(child)
        }
        Err(e) => {
            log(&format!("spawn() FAILED: {}", e));
            None
        }
    }
}

/// Gracefully shut down the server process.
/// Sends a termination request, waits up to 5 seconds for clean exit,
/// then force-kills if the process is still alive.
fn graceful_kill(child: &mut Child) {
    let pid = child.id();
    log(&format!("Shutting down server (PID {})...", pid));

    // Request graceful shutdown
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string()])
            .creation_flags(0x08000000)
            .spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill")
            .args(["-s", "TERM", &pid.to_string()])
            .spawn();
    }

    // Wait up to 5 seconds for clean exit
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                log(&format!("Server exited gracefully (status: {:?})", status.code()));
                return;
            }
            Ok(None) => {
                if start.elapsed() > std::time::Duration::from_secs(5) {
                    log("Server did not exit within 5s — force killing");
                    let _ = child.kill();
                    let _ = child.wait();
                    return;
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(e) => {
                log(&format!("Error waiting for server: {}", e));
                let _ = child.kill();
                return;
            }
        }
    }
}

/// Monitor the server process. If it exits unexpectedly, restart with
/// exponential backoff and emit status events to the frontend.
fn monitor_server(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut restart_count = 0u32;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(1));

            let state = app_handle.state::<ServerProcess>();
            let arc = state.0.clone();
            let mut guard = arc.lock().unwrap();

            // Check if the server was intentionally shut down
            if guard.is_none() {
                log("Server monitor: intentional shutdown detected, stopping");
                return;
            }

            let exited = match *guard {
                Some(ref mut child) => child.try_wait().unwrap_or(None).is_some(),
                None => false,
            };

            if !exited {
                continue;
            }

            // Server process exited unexpectedly — crash detected
            log(&format!("Server PID {} exited unexpectedly", guard.as_ref().map(|c| c.id()).unwrap_or(0)));
            *guard = None;
            drop(guard);

            log(&format!(
                "Server process exited unexpectedly (restart_count: {})",
                restart_count
            ));

            app_handle.emit("server-status", serde_json::json!({
                "status": "crashed",
                "message": "Server process exited unexpectedly",
                "restartCount": restart_count
            })).ok();

            restart_count += 1;

            // Exponential backoff: 1s, 2s, 4s, 8s, ... max 30s
            let delay_ms = std::cmp::min(1000u64 * 2u64.pow(restart_count.min(5)), 30_000);
            std::thread::sleep(std::time::Duration::from_millis(delay_ms));

            app_handle.emit("server-status", serde_json::json!({
                "status": "restarting",
                "message": format!("Restarting server (attempt {})...", restart_count),
                "restartCount": restart_count
            })).ok();

            // Attempt restart
            match start_server() {
                Some(new_child) => {
                    // Wait for readiness
                    let mut ready = false;
                    for _attempt in 0..30 {
                        std::thread::sleep(std::time::Duration::from_millis(500));
                        if std::net::TcpStream::connect("127.0.0.1:3000").is_ok() {
                            ready = true;
                            break;
                        }
                    }

                    if ready {
                        app_handle.emit("server-status", serde_json::json!({
                            "status": "ready",
                            "port": 3000,
                            "restartCount": restart_count
                        })).ok();
                        let mut guard = arc.lock().unwrap();
                        *guard = Some(new_child);
                    } else {
                        app_handle.emit("server-status", serde_json::json!({
                            "status": "fatal",
                            "message": "Server failed to restart"
                        })).ok();
                        return;
                    }
                }
                None => {
                    app_handle.emit("server-status", serde_json::json!({
                        "status": "fatal",
                        "message": "Could not restart server — node or script not found"
                    })).ok();
                    return;
                }
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ServerProcess(Arc::new(Mutex::new(None))))
        .manage(PtyManager::default())
        .setup(|app| {
            let child = start_server();
            let server_running = child.is_some();
            let state = app.state::<ServerProcess>();
            *state.0.lock().unwrap() = child;

            // Non-blocking server readiness check — emit events to frontend
            if server_running {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    handle.emit("server-status", serde_json::json!({
                        "status": "starting",
                        "message": "Starting Cabinet server..."
                    })).ok();

                    for attempt in 0..30 {
                        std::thread::sleep(std::time::Duration::from_millis(500));
                        if std::net::TcpStream::connect("127.0.0.1:3000").is_ok() {
                            log(&format!("Server ready after {}ms", (attempt + 1) * 500));
                            handle.emit("server-status", serde_json::json!({
                                "status": "ready",
                                "port": 3000,
                                "startupMs": (attempt + 1) * 500
                            })).ok();
                            return;
                        }
                    }

                    log("Server start timed out after 15s");
                    handle.emit("server-status", serde_json::json!({
                        "status": "timeout",
                        "message": "Server failed to start within 15 seconds"
                    })).ok();
                });
            } else if is_port_3000_alive() {
                app.handle().emit("server-status", serde_json::json!({
                    "status": "ready",
                    "port": 3000,
                    "reused": true
                })).ok();
            }

            // Start crash monitor (only when we own the server process)
            if server_running {
                monitor_server(app.handle().clone());
            }

            // Open devtools only when TAURI_DEVTOOLS=1 is set
            if std::env::var("TAURI_DEVTOOLS").ok().as_deref() == Some("1") {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }

            let show_item = MenuItem::with_id(app, "show", "Show Cabinet", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "Hide to Tray", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &hide_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Cabinet AI Collaboration")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "hide" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                    "quit" => {
                        let state = app.state::<ServerProcess>();
                        let mut guard = state.0.lock().unwrap();
                        if let Some(mut child) = guard.take() {
                            graceful_kill(&mut child);
                        }
                        drop(guard);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<ServerProcess>();
                let mut guard = state.0.lock().unwrap();
                if let Some(mut child) = guard.take() {
                    graceful_kill(&mut child);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet, minimize, maximize, close, is_maximized, open_devtools,
            pty::pty_spawn, pty::pty_write, pty::pty_resize, pty::pty_kill, pty::pty_list
        ])
        .run(tauri::generate_context!())
        .expect("error while running Cabinet");
}
