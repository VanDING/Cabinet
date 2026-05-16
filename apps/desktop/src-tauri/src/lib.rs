use std::process::{Child, Command};
use std::sync::Mutex;
use std::path::PathBuf;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

struct ServerProcess(Mutex<Option<Child>>);

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

fn kill_port_3000() {
    // Kill any orphaned server process from a previous run
    let output = std::process::Command::new("cmd")
        .args(["/c", "for /f \"tokens=5\" %a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do @taskkill //PID %a //F 2>nul"])
        .output();
    match &output {
        Ok(o) if o.status.success() => log("Killed orphan processes on port 3000"),
        Ok(_) => log("No orphan processes on port 3000 (or kill failed)"),
        Err(_) => log("Failed to check for orphan processes"),
    }
}

fn find_node() -> Option<String> {
    // Check multiple possible node paths on Windows
    let candidates = [
        "node.exe",
        "C:\\Program Files\\nodejs\\node.exe",
        "C:\\nvm4w\\nodejs\\node.exe",
        &format!("{}\\nodejs\\node.exe", std::env::var("ProgramFiles").unwrap_or_default().replace(" (x86)", "")),
    ];
    for c in &candidates {
        if let Ok(output) = Command::new(c).arg("--version").output() {
            if output.status.success() {
                println!("[Cabinet] Found node at: {}", c);
                return Some(c.to_string());
            }
        }
    }
    // Fallback: try the bare name
    if let Ok(output) = Command::new("node").arg("--version").output() {
        if output.status.success() {
            return Some("node".to_string());
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
    // 1) Production: {exe_dir}/resources/server/dist/main.js
    let resource = exe_dir.join("resources").join("server").join("dist").join("main.js");
    log(&format!("Checking resource path: {}", resource.display()));
    if resource.exists() {
        log("Resource script found!");
        return Some(resource);
    }

    // 2) Development: 4 levels up from target/release to apps/, then server/dist/main.js
    let dev_dist = exe_dir.join("..").join("..").join("..").join("..").join("server").join("dist").join("main.js");
    log(&format!("Checking dev path: {}", dev_dist.display()));
    log(&format!("  dev_dist exists: {}", dev_dist.exists()));
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

fn start_server() -> Option<Child> {
    log("start_server() called");
    kill_port_3000();

    let exe_dir = match std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())) {
        Some(d) => { log(&format!("exe_dir: {}", d.display())); d }
        None => { log("Failed to get exe_dir!"); return None; }
    };

    let node = match find_node() {
        Some(n) => { log(&format!("Found node: {}", n)); n }
        None => { log("find_node() returned None!"); return None; }
    };

    let server_script = match find_server_script(&exe_dir) {
        Some(s) => { log(&format!("Found server script: {}", s.display())); s }
        None => { log("find_server_script() returned None!"); return None; }
    };

    let server_dir = server_script.parent().unwrap_or(&exe_dir);
    log(&format!("Spawning: {} {} (cwd: {})", node, server_script.display(), server_dir.display()));

    match Command::new(&node)
        .arg(&server_script)
        .current_dir(server_dir)
        .spawn()
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ServerProcess(Mutex::new(None)))
        .setup(|app| {
            let child = start_server();
            let server_running = child.is_some();
            let state = app.state::<ServerProcess>();
            *state.0.lock().unwrap() = child;

            // Wait for server to be ready (up to 15s)
            if server_running {
                log("Waiting for server...");
                for attempt in 0..30 {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    if std::net::TcpStream::connect("127.0.0.1:3000").is_ok() {
                        log(&format!("Server ready after {}ms", (attempt + 1) * 500));
                        break;
                    }
                }
            }

            // Open devtools on startup for debugging
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
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
                        if let Some(ref mut child) = *guard {
                            let _ = child.kill();
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
                if let Some(ref mut child) = *guard {
                    let _ = child.kill();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![greet, minimize, maximize, close, is_maximized])
        .run(tauri::generate_context!())
        .expect("error while running Cabinet");
}
