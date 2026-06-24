// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), cfg_attr(windows, windows_subsystem = "windows"))]

fn main() {
    cabinet_lib::run()
}
