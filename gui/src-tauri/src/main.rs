// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Captured first thing, per spec §4 `main.rs`: `attach_ms` (from connect
    // start to the first `PaneSurface` applied) and `first_paint_ms` are
    // both measured from this instant for the `HERDR_GUI_BENCH=1` startup
    // bench output. Wiring this through to `report_ready` is left for the
    // implementer (see `herdr_gui_lib::run`).
    let start = std::time::Instant::now();
    herdr_gui_lib::run(start);
}
