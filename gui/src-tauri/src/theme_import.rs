//! VS Code theme import (spec phase1.5 §2.3 "Import").
//!
//! A `.vsix` is a zip archive: read `extension/package.json`, then
//! `contributes.themes[]: [{label, uiTheme, path}]` (a `.vsix` can hold
//! several themes -- import all of them). A `.json` is imported directly.
//! Theme JSON is JSONC (comments + trailing commas), parsed with the `json5`
//! crate. `"include": "./base.json"` resolves relative to the file (inside
//! the vsix or on disk); the child overrides the parent; depth <= 5 with
//! cycle detection. Only `colors` (+ `name`) are used; `tokenColors`/
//! `semanticTokenColors` are ignored (Phase 1.5 has no Monaco).
//!
//! Stored at `%APPDATA%\herdr-gui\themes\<slug>.json`, normalized to
//! `{name, type, colors}`.

use std::collections::{HashMap, HashSet};
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri_plugin_dialog::DialogExt;
use zip::ZipArchive;

use crate::commands::ApiError;

/// Declared sizes can lie (a zip entry's central-directory size, or a
/// pathological on-disk file); every file this module reads is capped at
/// this many bytes via `Read::take`, regardless of what it claims to be.
const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
const MAX_VSIX_ENTRIES: usize = 2000;
const MAX_INCLUDE_DEPTH: u32 = 5;
const MAX_COLOR_KEYS: usize = 2000;
/// Code review finding #13: a pathologically deep JSONC document (many
/// thousand nested `[`/`{`) can blow the recursive-descent parser's call
/// stack before it ever gets to producing a "the file is invalid" error.
/// Rejected lexically, before `json5::from_str` ever sees the text.
const MAX_JSON_NESTING_DEPTH: u32 = 64;

#[derive(Debug)]
pub enum ThemeImportError {
    Io(String),
    UnsupportedExtension,
    FileTooLarge,
    TooManyEntries,
    MissingEntry(String),
    ZipSlip,
    InvalidJson(String),
    InvalidThemeJson,
    IncludeTooDeep,
    IncludeCycle,
    NoThemesDeclared,
    /// Finding #13: an `include` that is absolute, UNC, drive-qualified, or
    /// names a Windows reserved device (`CON`, `NUL`, ...) in any segment,
    /// or a relative `include` whose `..`s would resolve outside the
    /// top-level theme file's own directory.
    UnsafeInclude,
    /// Finding #13: more than `MAX_JSON_NESTING_DEPTH` levels of `{`/`[`
    /// nesting, rejected before parsing.
    NestingTooDeep,
}

impl std::fmt::Display for ThemeImportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(msg) => write!(f, "I/O error: {msg}"),
            Self::UnsupportedExtension => {
                write!(f, "unsupported file extension (expected .json or .vsix)")
            }
            Self::FileTooLarge => write!(f, "file exceeds the 5 MB import limit"),
            Self::TooManyEntries => write!(f, "vsix has more than {MAX_VSIX_ENTRIES} entries"),
            Self::MissingEntry(name) => write!(f, "missing entry: {name}"),
            Self::ZipSlip => write!(f, "unsafe path in archive (zip-slip)"),
            Self::InvalidJson(msg) => write!(f, "invalid theme JSON: {msg}"),
            Self::InvalidThemeJson => write!(f, "theme file is not a JSON object"),
            Self::IncludeTooDeep => write!(f, "include chain exceeds depth {MAX_INCLUDE_DEPTH}"),
            Self::IncludeCycle => write!(f, "include cycle detected"),
            Self::NoThemesDeclared => write!(f, "package.json declares no contributes.themes"),
            Self::UnsafeInclude => write!(
                f,
                "include must be a relative path inside the theme's own directory"
            ),
            Self::NestingTooDeep => write!(
                f,
                "theme JSON nesting exceeds depth {MAX_JSON_NESTING_DEPTH}"
            ),
        }
    }
}

impl std::error::Error for ThemeImportError {}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StoredTheme {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub colors: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct StoredThemeWithSlug {
    pub slug: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub colors: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ImportedThemeSummary {
    pub slug: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
pub struct ThemeImportReport {
    pub imported: Vec<ImportedThemeSummary>,
    /// Total count of colour entries skipped across every imported theme,
    /// for a transient "N colours skipped" notice (spec §2.3 "Limits").
    pub skipped_keys: usize,
    pub errors: Vec<String>,
}

pub fn themes_dir() -> PathBuf {
    crate::settings::app_data_base()
        .join("herdr-gui")
        .join("themes")
}

// ---------------------------------------------------------------------------
// JSONC parsing
// ---------------------------------------------------------------------------

/// VS Code theme files are JSONC (comments + trailing commas). `json5` is a
/// superset that tolerates both, so it is used as the JSONC-tolerant parser
/// (spec §2.3: "a JSONC-tolerant parser, such as the json5 crate ... and
/// state the choice" -- this is that choice).
fn parse_jsonc(text: &str) -> Result<serde_json::Value, ThemeImportError> {
    if exceeds_max_nesting(text, MAX_JSON_NESTING_DEPTH) {
        return Err(ThemeImportError::NestingTooDeep);
    }
    json5::from_str(text).map_err(|err| ThemeImportError::InvalidJson(err.to_string()))
}

/// A lightweight, JSONC-aware lexical scan for `{`/`[` nesting depth: skips
/// `//` and `/* */` comments and the contents of quoted strings (so a
/// bracket character inside a string or comment never counts), and returns
/// `true` as soon as nesting would exceed `max_depth` -- short-circuiting
/// before the whole (potentially huge) text is scanned. This runs *before*
/// `json5::from_str`'s own recursive-descent parsing (finding #13: that
/// parser has no depth cap of its own, so a pathological input could
/// otherwise overflow its call stack).
fn exceeds_max_nesting(text: &str, max_depth: u32) -> bool {
    let bytes = text.as_bytes();
    let mut i = 0;
    let mut depth: u32 = 0;
    let mut in_string = false;
    while i < bytes.len() {
        let c = bytes[i];
        if in_string {
            match c {
                b'\\' => i += 1, // the following char is escaped; skip it too.
                b'"' => in_string = false,
                _ => {}
            }
            i += 1;
            continue;
        }
        match c {
            b'"' => {
                in_string = true;
                i += 1;
            }
            b'/' if bytes.get(i + 1) == Some(&b'/') => {
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
            }
            b'/' if bytes.get(i + 1) == Some(&b'*') => {
                i += 2;
                while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                    i += 1;
                }
                i = (i + 2).min(bytes.len());
            }
            b'{' | b'[' => {
                depth += 1;
                if depth > max_depth {
                    return true;
                }
                i += 1;
            }
            b'}' | b']' => {
                depth = depth.saturating_sub(1);
                i += 1;
            }
            _ => i += 1,
        }
    }
    false
}

fn is_valid_key(key: &str) -> bool {
    !key.is_empty() && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '.')
}

/// `#rgb`, `#rgba`, `#rrggbb`, or `#rrggbbaa` (spec §2.3 "Limits").
fn is_valid_color(value: &str) -> bool {
    let Some(hex) = value.strip_prefix('#') else {
        return false;
    };
    matches!(hex.len(), 3 | 4 | 6 | 8) && hex.chars().all(|c| c.is_ascii_hexdigit())
}

fn read_capped<R: Read>(mut reader: R) -> Result<Vec<u8>, ThemeImportError> {
    let mut buf = Vec::new();
    reader
        .by_ref()
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut buf)
        .map_err(|err| ThemeImportError::Io(err.to_string()))?;
    if buf.len() as u64 > MAX_FILE_BYTES {
        return Err(ThemeImportError::FileTooLarge);
    }
    Ok(buf)
}

// ---------------------------------------------------------------------------
// `include` resolution, shared by the disk and vsix sources
// ---------------------------------------------------------------------------

trait ThemeFileSource {
    fn read(&mut self, path: &str) -> Result<Vec<u8>, ThemeImportError>;
    fn resolve(&self, from: &str, include: &str) -> Result<String, ThemeImportError>;
}

#[derive(Debug, Clone, Default, PartialEq)]
struct ResolvedTheme {
    name: Option<String>,
    kind: Option<String>,
    colors: HashMap<String, String>,
    invalid_keys: usize,
}

fn load_chain(
    source: &mut dyn ThemeFileSource,
    path: &str,
    depth: u32,
    visited: &mut HashSet<String>,
) -> Result<ResolvedTheme, ThemeImportError> {
    if depth > MAX_INCLUDE_DEPTH {
        return Err(ThemeImportError::IncludeTooDeep);
    }
    if !visited.insert(path.to_string()) {
        return Err(ThemeImportError::IncludeCycle);
    }

    let bytes = source.read(path)?;
    let text = String::from_utf8_lossy(&bytes);
    let value = parse_jsonc(&text)?;
    let obj = value
        .as_object()
        .ok_or(ThemeImportError::InvalidThemeJson)?;

    let mut resolved = match obj.get("include").and_then(|v| v.as_str()) {
        Some(include) => {
            let next_path = source.resolve(path, include)?;
            load_chain(source, &next_path, depth + 1, visited)?
        }
        None => ResolvedTheme::default(),
    };

    if let Some(name) = obj.get("name").and_then(|v| v.as_str()) {
        resolved.name = Some(name.to_string());
    }
    if let Some(kind) = obj.get("type").and_then(|v| v.as_str()) {
        resolved.kind = Some(kind.to_string());
    }
    if let Some(colors) = obj.get("colors").and_then(|v| v.as_object()) {
        for (key, value) in colors {
            let is_new_key = !resolved.colors.contains_key(key);
            let over_cap = is_new_key && resolved.colors.len() >= MAX_COLOR_KEYS;
            let valid_value = value.as_str().filter(|s| is_valid_color(s));
            match (is_valid_key(key), valid_value, over_cap) {
                (true, Some(color), false) => {
                    resolved.colors.insert(key.clone(), color.to_string());
                }
                _ => resolved.invalid_keys += 1,
            }
        }
    }

    Ok(resolved)
}

// ---------------------------------------------------------------------------
// Disk source (a standalone `.json` import)
// ---------------------------------------------------------------------------

/// Rejects an `include` value that is absolute, UNC/drive-qualified, or
/// names a Windows reserved device (`CON`, `NUL`, `PRN`, `AUX`, `COM1-9`,
/// `LPT1-9`) in any path segment (finding #13). Opening one of those device
/// names -- even as a "relative" segment nested anywhere in the path --
/// reads/writes a device, not a file, on Windows.
fn has_unsafe_include_segment(include: &str) -> bool {
    if Path::new(include).is_absolute() {
        return true;
    }
    let normalized = include.replace('\\', "/");
    if normalized.starts_with('/') || normalized.contains(':') {
        return true;
    }
    normalized.split('/').any(|segment| {
        if segment.is_empty() || segment == "." || segment == ".." {
            return false;
        }
        let base = segment
            .split('.')
            .next()
            .unwrap_or(segment)
            .to_ascii_uppercase();
        base == "CON"
            || base == "PRN"
            || base == "AUX"
            || base == "NUL"
            || ((base.starts_with("COM") || base.starts_with("LPT"))
                && base.len() == 4
                && base.as_bytes()[3].is_ascii_digit())
    })
}

/// Resolves `include` against `base_dir`, purely lexically (no filesystem
/// access, so a nonexistent intermediate directory never errors out here),
/// and rejects the result if it would land outside `root_dir` -- the
/// top-level theme file's own directory (finding #13: "resolve inside the
/// theme's own dir"). Mirrors `normalize_vsix_relative_path`'s `..`-popping
/// scheme, but bounded by `root_dir` instead of an archive root.
fn normalize_disk_relative_path(
    base_dir: &Path,
    root_dir: &Path,
    include: &str,
) -> Result<PathBuf, ThemeImportError> {
    if has_unsafe_include_segment(include) {
        return Err(ThemeImportError::UnsafeInclude);
    }
    let relative_base = base_dir
        .strip_prefix(root_dir)
        .unwrap_or_else(|_| Path::new(""));
    let mut stack: Vec<std::ffi::OsString> = relative_base
        .components()
        .map(|c| c.as_os_str().to_os_string())
        .collect();
    for segment in include.replace('\\', "/").split('/') {
        match segment {
            "" | "." => continue,
            ".." => {
                if stack.pop().is_none() {
                    return Err(ThemeImportError::UnsafeInclude);
                }
            }
            other => stack.push(std::ffi::OsString::from(other)),
        }
    }
    let mut resolved = root_dir.to_path_buf();
    resolved.extend(stack);
    Ok(resolved)
}

struct DiskSource {
    /// The top-level theme file's own directory: the boundary no `include`
    /// chain may resolve outside of (finding #13).
    root_dir: PathBuf,
}

impl ThemeFileSource for DiskSource {
    fn read(&mut self, path: &str) -> Result<Vec<u8>, ThemeImportError> {
        let file =
            std::fs::File::open(path).map_err(|err| ThemeImportError::Io(err.to_string()))?;
        read_capped(file)
    }

    fn resolve(&self, from: &str, include: &str) -> Result<String, ThemeImportError> {
        let base_dir = Path::new(from).parent().unwrap_or_else(|| Path::new("."));
        let resolved = normalize_disk_relative_path(base_dir, &self.root_dir, include)?;
        Ok(resolved.to_string_lossy().to_string())
    }
}

// ---------------------------------------------------------------------------
// Vsix source (a `.vsix` zip archive)
// ---------------------------------------------------------------------------

/// Resolves `include_rel` against `base_dir` inside the archive's virtual
/// path tree, purely lexically (no filesystem access): `..` pops a segment,
/// and popping past the archive root is rejected as zip-slip. This is the
/// primary zip-slip guard for include resolution; `ZipFile::enclosed_name()`
/// (checked in `VsixSource::read`) guards direct entry lookups too.
fn normalize_vsix_relative_path(
    base_dir: &str,
    include_rel: &str,
) -> Result<String, ThemeImportError> {
    let mut stack: Vec<String> = base_dir
        .split('/')
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    let normalized = include_rel.replace('\\', "/");
    let trimmed = normalized.strip_prefix("./").unwrap_or(normalized.as_str());
    for segment in trimmed.split('/') {
        match segment {
            "" | "." => continue,
            ".." => {
                if stack.pop().is_none() {
                    return Err(ThemeImportError::ZipSlip);
                }
            }
            other => stack.push(other.to_string()),
        }
    }
    Ok(stack.join("/"))
}

fn parent_of(path: &str) -> &str {
    match path.rfind('/') {
        Some(idx) => &path[..idx],
        None => "",
    }
}

struct VsixSource<'a> {
    archive: &'a mut ZipArchive<Cursor<Vec<u8>>>,
}

impl ThemeFileSource for VsixSource<'_> {
    fn read(&mut self, path: &str) -> Result<Vec<u8>, ThemeImportError> {
        let mut file = self
            .archive
            .by_name(path)
            .map_err(|_| ThemeImportError::MissingEntry(path.to_string()))?;
        if file.enclosed_name().is_none() {
            return Err(ThemeImportError::ZipSlip);
        }
        read_capped(&mut file)
    }

    fn resolve(&self, from: &str, include: &str) -> Result<String, ThemeImportError> {
        normalize_vsix_relative_path(parent_of(from), include)
    }
}

// ---------------------------------------------------------------------------
// Theme kind + slug + storage
// ---------------------------------------------------------------------------

/// Spec §2.3 "Theme type": normally derived from the vsix `uiTheme` (`vs` ->
/// light, `vs-dark` -> dark, `hc-*` -> hc); "Use the JSON `type` only if it
/// is present" -- the theme file's own `type` field, when set, wins.
fn resolve_theme_kind(ui_theme: Option<&str>, json_type: Option<&str>) -> String {
    if let Some(t) = json_type {
        return match t {
            "light" => "light",
            "dark" => "dark",
            t if t.starts_with("hc") => "hc",
            _ => "dark",
        }
        .to_string();
    }
    match ui_theme {
        Some("vs") => "light",
        Some("vs-dark") => "dark",
        Some(t) if t.starts_with("hc") => "hc",
        _ => "dark",
    }
    .to_string()
}

fn slugify(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "theme".to_string()
    } else {
        out
    }
}

fn unique_slug(name: &str, used: &HashSet<String>) -> String {
    let base = slugify(name);
    if !used.contains(&base) {
        return base;
    }
    let mut n = 2;
    loop {
        let candidate = format!("{base}-{n}");
        if !used.contains(&candidate) {
            return candidate;
        }
        n += 1;
    }
}

fn existing_slugs(themes_dir: &Path) -> HashSet<String> {
    let Ok(entries) = std::fs::read_dir(themes_dir) else {
        return HashSet::new();
    };
    entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            entry
                .path()
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
        })
        .collect()
}

fn finalize_and_store(
    resolved: ResolvedTheme,
    fallback_name: &str,
    ui_theme: Option<&str>,
    themes_dir: &Path,
    used_slugs: &mut HashSet<String>,
) -> Result<ImportedThemeSummary, ThemeImportError> {
    let name = resolved.name.unwrap_or_else(|| fallback_name.to_string());
    let kind = resolve_theme_kind(ui_theme, resolved.kind.as_deref());
    let slug = unique_slug(&name, used_slugs);
    used_slugs.insert(slug.clone());

    let stored = StoredTheme {
        name: name.clone(),
        kind,
        colors: resolved.colors,
    };
    let json = serde_json::to_string_pretty(&stored)
        .map_err(|err| ThemeImportError::Io(err.to_string()))?;
    std::fs::create_dir_all(themes_dir).map_err(|err| ThemeImportError::Io(err.to_string()))?;
    std::fs::write(themes_dir.join(format!("{slug}.json")), json)
        .map_err(|err| ThemeImportError::Io(err.to_string()))?;

    Ok(ImportedThemeSummary { slug, name })
}

// ---------------------------------------------------------------------------
// Top-level import
// ---------------------------------------------------------------------------

fn import_json_file(path: &Path, themes_dir: &Path) -> Result<ThemeImportReport, ThemeImportError> {
    let root_dir = path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf();
    let mut source = DiskSource { root_dir };
    let mut visited = HashSet::new();
    let path_str = path.to_string_lossy().to_string();
    let resolved = load_chain(&mut source, &path_str, 0, &mut visited)?;

    let fallback_name = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Imported Theme".to_string());
    let mut used_slugs = existing_slugs(themes_dir);
    let skipped_keys = resolved.invalid_keys;
    let summary = finalize_and_store(resolved, &fallback_name, None, themes_dir, &mut used_slugs)?;

    Ok(ThemeImportReport {
        imported: vec![summary],
        skipped_keys,
        errors: Vec::new(),
    })
}

fn import_vsix_bytes(
    bytes: Vec<u8>,
    themes_dir: &Path,
) -> Result<ThemeImportReport, ThemeImportError> {
    let mut archive =
        ZipArchive::new(Cursor::new(bytes)).map_err(|err| ThemeImportError::Io(err.to_string()))?;
    if archive.len() > MAX_VSIX_ENTRIES {
        return Err(ThemeImportError::TooManyEntries);
    }

    let manifest_bytes = {
        let mut source = VsixSource {
            archive: &mut archive,
        };
        source.read("extension/package.json")?
    };
    let manifest_text = String::from_utf8_lossy(&manifest_bytes).to_string();
    let manifest = parse_jsonc(&manifest_text)?;
    let theme_entries = manifest
        .get("contributes")
        .and_then(|c| c.get("themes"))
        .and_then(|t| t.as_array())
        .cloned()
        .unwrap_or_default();
    if theme_entries.is_empty() {
        return Err(ThemeImportError::NoThemesDeclared);
    }

    let mut report = ThemeImportReport::default();
    let mut used_slugs = existing_slugs(themes_dir);
    for entry in theme_entries {
        let label = entry
            .get("label")
            .and_then(|v| v.as_str())
            .unwrap_or("theme")
            .to_string();
        let ui_theme = entry
            .get("uiTheme")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let Some(rel_path) = entry.get("path").and_then(|v| v.as_str()) else {
            report.errors.push(format!("theme '{label}' has no path"));
            continue;
        };

        let resolved_path = match normalize_vsix_relative_path("extension", rel_path) {
            Ok(p) => p,
            Err(err) => {
                report.errors.push(format!("theme '{label}': {err}"));
                continue;
            }
        };

        let mut source = VsixSource {
            archive: &mut archive,
        };
        let mut visited = HashSet::new();
        match load_chain(&mut source, &resolved_path, 0, &mut visited) {
            Ok(resolved) => {
                report.skipped_keys += resolved.invalid_keys;
                match finalize_and_store(
                    resolved,
                    &label,
                    ui_theme.as_deref(),
                    themes_dir,
                    &mut used_slugs,
                ) {
                    Ok(summary) => report.imported.push(summary),
                    Err(err) => report.errors.push(format!("theme '{label}': {err}")),
                }
            }
            Err(err) => report.errors.push(format!("theme '{label}': {err}")),
        }
    }

    Ok(report)
}

pub fn import_theme_file(
    path: &Path,
    themes_dir: &Path,
) -> Result<ThemeImportReport, ThemeImportError> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "json" => import_json_file(path, themes_dir),
        "vsix" => {
            let bytes = read_capped(
                std::fs::File::open(path).map_err(|err| ThemeImportError::Io(err.to_string()))?,
            )?;
            import_vsix_bytes(bytes, themes_dir)
        }
        _ => Err(ThemeImportError::UnsupportedExtension),
    }
}

pub fn list_stored_themes(themes_dir: &Path) -> Vec<StoredThemeWithSlug> {
    let Ok(entries) = std::fs::read_dir(themes_dir) else {
        return Vec::new();
    };
    let mut themes: Vec<StoredThemeWithSlug> = entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                return None;
            }
            let slug = path.file_stem()?.to_string_lossy().to_string();
            let contents = std::fs::read_to_string(&path).ok()?;
            let stored: StoredTheme = serde_json::from_str(&contents).ok()?;
            Some(StoredThemeWithSlug {
                slug,
                name: stored.name,
                kind: stored.kind,
                colors: stored.colors,
            })
        })
        .collect();
    themes.sort_by(|a, b| a.name.cmp(&b.name));
    themes
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// `View ▸ Import VS Code Theme…` (spec §2.3, finding #13): the file picker
/// and the import both run here, in Rust. The old, separate
/// `pick_theme_file` -> `import_vscode_theme(path)` round trip let the
/// webview substitute any path string of its own for the one the user
/// actually picked; folding the two into one command with no `path`
/// parameter closes that off entirely. Returns `None` when the user
/// cancels the dialog.
#[tauri::command]
pub async fn import_vscode_theme(
    app: tauri::AppHandle,
) -> Result<Option<ThemeImportReport>, ApiError> {
    let file = app
        .dialog()
        .file()
        .add_filter("VS Code theme", &["json", "vsix"])
        .blocking_pick_file();
    let Some(file) = file else {
        return Ok(None);
    };
    let path = PathBuf::from(file.to_string());
    let report = import_theme_file(&path, &themes_dir()).map_err(|err| ApiError {
        code: "theme_import_error".to_string(),
        message: err.to_string(),
    })?;
    Ok(Some(report))
}

#[tauri::command]
pub async fn list_imported_themes() -> Result<Vec<StoredThemeWithSlug>, ApiError> {
    Ok(list_stored_themes(&themes_dir()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("herdr-gui-theme-import-test-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn jsonc_tolerates_comments_and_trailing_commas() {
        let text = r##"{
            // a line comment
            "name": "Test Theme", /* block comment */
            "type": "dark",
            "colors": {
                "editor.background": "#1f1f1f",
            },
        }"##;
        let value = parse_jsonc(text).expect("json5 tolerates JSONC comments and trailing commas");
        assert_eq!(value["name"], "Test Theme");
    }

    #[test]
    fn is_valid_color_accepts_all_four_hex_forms() {
        assert!(is_valid_color("#abc"));
        assert!(is_valid_color("#abcd"));
        assert!(is_valid_color("#aabbcc"));
        assert!(is_valid_color("#aabbccdd"));
        assert!(!is_valid_color("aabbcc"));
        assert!(!is_valid_color("#zzzzzz"));
        assert!(!is_valid_color("#ab"));
        assert!(!is_valid_color("rgb(0,0,0)"));
    }

    #[test]
    fn is_valid_key_rejects_anything_outside_alnum_and_dot() {
        assert!(is_valid_key("editor.background"));
        assert!(is_valid_key("herdr.status.working"));
        assert!(!is_valid_key("editor background"));
        assert!(!is_valid_key("editor;background"));
        assert!(!is_valid_key(""));
    }

    #[test]
    fn invalid_colors_are_skipped_and_counted() {
        let dir = temp_dir("invalid-colors");
        let json = r##"{
            "name": "Partial",
            "type": "dark",
            "colors": {
                "editor.background": "#1f1f1f",
                "bad key": "#000000",
                "editor.foreground": "not-a-color",
                "terminal.background": "#0c0c0c"
            }
        }"##;
        let file = dir.join("theme.json");
        std::fs::write(&file, json).unwrap();
        let report = import_json_file(&file, &dir).unwrap();
        assert_eq!(report.skipped_keys, 2);
        assert_eq!(report.imported.len(), 1);
        let stored: StoredTheme = serde_json::from_str(
            &std::fs::read_to_string(dir.join(format!("{}.json", report.imported[0].slug)))
                .unwrap(),
        )
        .unwrap();
        assert_eq!(stored.colors.len(), 2);
    }

    #[test]
    fn disk_include_resolves_relative_to_the_file_and_child_overrides_parent() {
        let dir = temp_dir("disk-include");
        std::fs::write(
            dir.join("base.json"),
            r##"{"name":"Base","type":"dark","colors":{"editor.background":"#111111","editor.foreground":"#eeeeee"}}"##,
        )
        .unwrap();
        std::fs::write(
            dir.join("child.json"),
            r##"{"include":"./base.json","name":"Child","colors":{"editor.background":"#222222"}}"##,
        )
        .unwrap();
        let report = import_json_file(&dir.join("child.json"), &dir).unwrap();
        assert_eq!(report.imported[0].name, "Child");
        let stored: StoredTheme = serde_json::from_str(
            &std::fs::read_to_string(dir.join(format!("{}.json", report.imported[0].slug)))
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            stored.colors["editor.background"], "#222222",
            "child overrides parent"
        );
        assert_eq!(
            stored.colors["editor.foreground"], "#eeeeee",
            "parent-only key is inherited"
        );
    }

    // -- finding #13: unsafe `include` values (disk source) --------------

    #[test]
    fn unsafe_include_detects_absolute_unc_drive_and_device_names() {
        assert!(has_unsafe_include_segment(
            "C:/Windows/System32/drivers/etc/hosts"
        ));
        assert!(has_unsafe_include_segment("C:\\Windows\\System32"));
        assert!(has_unsafe_include_segment("\\\\server\\share\\file.json"));
        assert!(has_unsafe_include_segment("//server/share/file.json"));
        assert!(has_unsafe_include_segment("CON"));
        assert!(has_unsafe_include_segment("con.json"));
        assert!(has_unsafe_include_segment("sub/NUL"));
        assert!(has_unsafe_include_segment("COM1"));
        assert!(has_unsafe_include_segment("lpt9.json"));
        assert!(!has_unsafe_include_segment("./base.json"));
        assert!(!has_unsafe_include_segment("../sibling/base.json"));
        assert!(
            !has_unsafe_include_segment("consoles.json"),
            "must not false-positive on a prefix match"
        );
    }

    #[test]
    fn disk_include_absolute_drive_path_is_rejected() {
        let dir = temp_dir("unsafe-absolute");
        std::fs::write(
            dir.join("child.json"),
            r##"{"include":"C:/secret.json","name":"Child"}"##,
        )
        .unwrap();
        let err = import_json_file(&dir.join("child.json"), &dir).unwrap_err();
        assert!(matches!(err, ThemeImportError::UnsafeInclude));
    }

    #[test]
    fn disk_include_device_name_is_rejected() {
        let dir = temp_dir("unsafe-device");
        std::fs::write(
            dir.join("child.json"),
            r##"{"include":"CON","name":"Child"}"##,
        )
        .unwrap();
        let err = import_json_file(&dir.join("child.json"), &dir).unwrap_err();
        assert!(matches!(err, ThemeImportError::UnsafeInclude));
    }

    #[test]
    fn disk_include_dot_dot_escaping_the_root_is_rejected() {
        let dir = temp_dir("unsafe-traversal");
        std::fs::write(
            dir.join("child.json"),
            r##"{"include":"../../outside.json","name":"Child"}"##,
        )
        .unwrap();
        let err = import_json_file(&dir.join("child.json"), &dir).unwrap_err();
        assert!(matches!(err, ThemeImportError::UnsafeInclude));
    }

    #[test]
    fn disk_include_dot_dot_that_stays_inside_the_root_is_allowed() {
        // child.json (root) -> ./sub/mid.json -> ../base.json: the second
        // hop's `..` climbs back from `dir/sub` to `dir/base.json`, which is
        // still inside the *top-level* file's own directory (`dir`), so it
        // must be allowed even though a bare `..` from the root itself is not.
        let dir = temp_dir("safe-traversal");
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(
            dir.join("base.json"),
            r##"{"name":"Base","colors":{"editor.background":"#111111"}}"##,
        )
        .unwrap();
        std::fs::write(
            dir.join("sub/mid.json"),
            r##"{"include":"../base.json","name":"Mid","colors":{}}"##,
        )
        .unwrap();
        std::fs::write(
            dir.join("child.json"),
            r##"{"include":"./sub/mid.json","name":"Child","colors":{}}"##,
        )
        .unwrap();
        let report = import_json_file(&dir.join("child.json"), &dir).unwrap();
        assert_eq!(report.imported[0].name, "Child");
    }

    // -- finding #13: JSONC nesting depth cap -----------------------------

    #[test]
    fn deeply_nested_json_is_rejected_before_parsing() {
        let nested = "[".repeat(70) + &"]".repeat(70);
        let err = parse_jsonc(&nested).unwrap_err();
        assert!(matches!(err, ThemeImportError::NestingTooDeep));
    }

    #[test]
    fn nesting_within_the_cap_is_allowed() {
        let nested = "[".repeat(10) + &"]".repeat(10);
        assert!(parse_jsonc(&nested).is_ok());
    }

    #[test]
    fn nesting_inside_a_string_or_comment_is_not_counted() {
        let text = format!(
            r##"{{"name": "{}", "colors": {{}}}} // {}"##,
            "[".repeat(200),
            "[".repeat(200)
        );
        assert!(parse_jsonc(&text).is_ok());
    }

    #[test]
    fn include_depth_beyond_five_is_rejected() {
        let dir = temp_dir("depth");
        // 7 files chained: 0 includes 1 includes 2 ... includes 6 (6 hops).
        for i in 0..7 {
            let body = if i == 6 {
                format!(r##"{{"name":"L{i}","type":"dark","colors":{{}}}}"##)
            } else {
                format!(
                    r##"{{"include":"./l{}.json","name":"L{i}","colors":{{}}}}"##,
                    i + 1
                )
            };
            std::fs::write(dir.join(format!("l{i}.json")), body).unwrap();
        }
        let err = import_json_file(&dir.join("l0.json"), &dir).unwrap_err();
        assert!(matches!(err, ThemeImportError::IncludeTooDeep));
    }

    #[test]
    fn include_depth_of_exactly_five_is_allowed() {
        let dir = temp_dir("depth-ok");
        for i in 0..6 {
            let body = if i == 5 {
                format!(r##"{{"name":"L{i}","type":"dark","colors":{{}}}}"##)
            } else {
                format!(
                    r##"{{"include":"./l{}.json","name":"L{i}","colors":{{}}}}"##,
                    i + 1
                )
            };
            std::fs::write(dir.join(format!("l{i}.json")), body).unwrap();
        }
        let report = import_json_file(&dir.join("l0.json"), &dir).unwrap();
        assert_eq!(report.imported.len(), 1);
    }

    #[test]
    fn include_cycle_is_rejected() {
        let dir = temp_dir("cycle");
        std::fs::write(dir.join("a.json"), r##"{"include":"./b.json","name":"A"}"##).unwrap();
        std::fs::write(dir.join("b.json"), r##"{"include":"./a.json","name":"B"}"##).unwrap();
        let err = import_json_file(&dir.join("a.json"), &dir).unwrap_err();
        assert!(matches!(err, ThemeImportError::IncludeCycle));
    }

    #[test]
    fn file_over_five_megabytes_is_rejected() {
        let dir = temp_dir("too-large");
        let file = dir.join("huge.json");
        let mut f = std::fs::File::create(&file).unwrap();
        // A padded, still-parseable-if-it-were-read JSON string well over
        // the 5 MiB cap; the cap must trip before parsing is attempted.
        f.write_all(b"{\"name\":\"Huge\",\"colors\":{},\"padding\":\"")
            .unwrap();
        let chunk = vec![b'x'; 1024 * 1024];
        for _ in 0..6 {
            f.write_all(&chunk).unwrap();
        }
        f.write_all(b"\"}").unwrap();
        drop(f);
        let err = import_json_file(&file, &dir).unwrap_err();
        assert!(matches!(err, ThemeImportError::FileTooLarge));
    }

    #[test]
    fn zip_slip_via_include_traversal_is_rejected() {
        assert_eq!(
            normalize_vsix_relative_path("extension/themes", "../../../outside.json")
                .unwrap_err()
                .to_string(),
            ThemeImportError::ZipSlip.to_string()
        );
    }

    #[test]
    fn normalize_vsix_relative_path_resolves_dot_dot_within_bounds() {
        let resolved = normalize_vsix_relative_path("extension/themes", "../icons/x.png").unwrap();
        assert_eq!(resolved, "extension/icons/x.png");
    }

    fn write_zip_entry(zip: &mut ZipWriter<Cursor<Vec<u8>>>, name: &str, contents: &str) {
        zip.start_file(name, SimpleFileOptions::default()).unwrap();
        zip.write_all(contents.as_bytes()).unwrap();
    }

    fn build_test_vsix(themes_json: &str, package_json: &str) -> Vec<u8> {
        let cursor = Cursor::new(Vec::new());
        let mut zip = ZipWriter::new(cursor);
        write_zip_entry(&mut zip, "extension/package.json", package_json);
        write_zip_entry(&mut zip, "extension/themes/theme.json", themes_json);
        zip.finish().unwrap().into_inner()
    }

    #[test]
    fn vsix_relative_path_resolves_against_the_extension_root() {
        let package_json = r##"{"contributes":{"themes":[{"label":"My Theme","uiTheme":"vs-dark","path":"./themes/theme.json"}]}}"##;
        let theme_json = r##"{"colors":{"editor.background":"#101010"}}"##;
        let bytes = build_test_vsix(theme_json, package_json);
        let dir = temp_dir("vsix-relative");
        let report = import_vsix_bytes(bytes, &dir).expect("vsix imports");
        assert_eq!(report.imported.len(), 1);
        assert_eq!(report.imported[0].name, "My Theme");
        let stored: StoredTheme = serde_json::from_str(
            &std::fs::read_to_string(dir.join(format!("{}.json", report.imported[0].slug)))
                .unwrap(),
        )
        .unwrap();
        assert_eq!(stored.kind, "dark");
        assert_eq!(stored.colors["editor.background"], "#101010");
    }

    #[test]
    fn vsix_with_several_themes_imports_all_of_them() {
        let package_json = r##"{"contributes":{"themes":[
            {"label":"Theme Light","uiTheme":"vs","path":"./themes/light.json"},
            {"label":"Theme Dark","uiTheme":"vs-dark","path":"./themes/dark.json"}
        ]}}"##;
        let cursor = Cursor::new(Vec::new());
        let mut zip = ZipWriter::new(cursor);
        write_zip_entry(&mut zip, "extension/package.json", package_json);
        write_zip_entry(
            &mut zip,
            "extension/themes/light.json",
            r##"{"colors":{"editor.background":"#ffffff"}}"##,
        );
        write_zip_entry(
            &mut zip,
            "extension/themes/dark.json",
            r##"{"colors":{"editor.background":"#000000"}}"##,
        );
        let bytes = zip.finish().unwrap().into_inner();

        let dir = temp_dir("vsix-several");
        let report = import_vsix_bytes(bytes, &dir).expect("vsix imports");
        assert_eq!(report.imported.len(), 2);
        let names: HashSet<_> = report.imported.iter().map(|t| t.name.clone()).collect();
        assert!(names.contains("Theme Light"));
        assert!(names.contains("Theme Dark"));
        let kinds: HashSet<_> = report
            .imported
            .iter()
            .map(|t| {
                let stored: StoredTheme = serde_json::from_str(
                    &std::fs::read_to_string(dir.join(format!("{}.json", t.slug))).unwrap(),
                )
                .unwrap();
                stored.kind
            })
            .collect();
        assert!(kinds.contains("light"));
        assert!(kinds.contains("dark"));
    }

    #[test]
    fn vsix_json_type_field_overrides_ui_theme() {
        let package_json = r##"{"contributes":{"themes":[{"label":"Weird","uiTheme":"vs","path":"./themes/theme.json"}]}}"##;
        // uiTheme says light, but the theme file's own `type` says dark: the
        // JSON `type` wins (spec §2.3 "Use the JSON type only if it is present").
        let theme_json = r##"{"type":"dark","colors":{}}"##;
        let bytes = build_test_vsix(theme_json, package_json);
        let dir = temp_dir("vsix-type-override");
        let report = import_vsix_bytes(bytes, &dir).unwrap();
        let stored: StoredTheme = serde_json::from_str(
            &std::fs::read_to_string(dir.join(format!("{}.json", report.imported[0].slug)))
                .unwrap(),
        )
        .unwrap();
        assert_eq!(stored.kind, "dark");
    }

    #[test]
    fn slug_collisions_are_deduplicated() {
        let mut used = HashSet::new();
        let first = unique_slug("My Theme", &used);
        used.insert(first.clone());
        let second = unique_slug("My Theme", &used);
        assert_eq!(first, "my-theme");
        assert_eq!(second, "my-theme-2");
    }

    #[test]
    fn list_stored_themes_reads_back_what_was_imported() {
        let dir = temp_dir("list");
        std::fs::write(
            dir.join("theme.json"),
            r##"{"name":"Solo","type":"dark","colors":{"editor.background":"#101010"}}"##,
        )
        .unwrap();
        let themes = list_stored_themes(&dir);
        assert_eq!(themes.len(), 1);
        assert_eq!(themes[0].name, "Solo");
        assert_eq!(themes[0].slug, "theme");
    }
}
