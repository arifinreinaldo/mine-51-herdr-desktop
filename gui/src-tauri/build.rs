fn main() {
    // The exe and window icons are embedded at build time. Without this, an
    // incremental build keeps the old icon after `tauri icon` replaces the files.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build();
}
