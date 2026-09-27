use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    embed_engine_payload();
    tauri_build::build();
}

/// Phase 1.6 addendum §11.1: the portable build embeds the pinned herdr
/// release zip and `install.ps1` into `OUT_DIR` when
/// `HERDR_GUI_EMBED_ENGINE=1` (set by `scripts/package.mjs`); `engine.rs`
/// pulls them back out with `include_bytes!`. Without the env var -- a dev
/// build, `npm run check`, or a fresh clone with no zip downloaded yet --
/// this writes empty placeholder files instead, so the crate still
/// compiles either way; `engine.rs` treats an empty payload as "no bundled
/// engine" (`installAvailable: false`, spec §11.1 "it never crashes").
fn embed_engine_payload() {
    let manifest_dir =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by cargo"));
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR is set by cargo"));

    let zip_src = manifest_dir.join("resources/herdr/herdr-windows-x86_64.zip");
    let install_ps1_src = manifest_dir.join("resources/herdr/install.ps1");
    let zip_dst = out_dir.join("herdr-engine.zip");
    let install_ps1_dst = out_dir.join("herdr-install.ps1");

    // Re-run this script (and so re-decide the embed) whenever the toggle or
    // either source file changes -- a stale OUT_DIR copy must never survive
    // a re-fetch of the pinned zip or a flip of the env var.
    println!("cargo:rerun-if-env-changed=HERDR_GUI_EMBED_ENGINE");
    println!("cargo:rerun-if-changed={}", zip_src.display());
    println!("cargo:rerun-if-changed={}", install_ps1_src.display());

    let embed = env::var("HERDR_GUI_EMBED_ENGINE").ok().as_deref() == Some("1");
    if embed {
        fs::copy(&zip_src, &zip_dst).unwrap_or_else(|err| {
            panic!(
                "HERDR_GUI_EMBED_ENGINE=1 but {} could not be copied ({err}). \
                 Run `node scripts/fetch-herdr-package.mjs` first.",
                zip_src.display()
            )
        });
        fs::copy(&install_ps1_src, &install_ps1_dst).unwrap_or_else(|err| {
            panic!(
                "HERDR_GUI_EMBED_ENGINE=1 but {} could not be copied ({err}).",
                install_ps1_src.display()
            )
        });
    } else {
        fs::write(&zip_dst, []).expect("write empty engine zip placeholder");
        fs::write(&install_ps1_dst, []).expect("write empty install.ps1 placeholder");
    }
}
