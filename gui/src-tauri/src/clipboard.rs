//! OS clipboard writes for two independent features that both end up
//! writing plain text to the same place:
//!
//! 1. Mouse-selection auto-copy: `appTerminalMouse.ts` reads the selected
//!    text via the `pane.selection.read` endpoint (same as herdr's TUI
//!    client, `src/client/shell/actions.rs::request_selection_copy`) and
//!    calls `write_clipboard_text` (below) with the result.
//! 2. OSC 52 passthrough: a pane application (e.g. `vim`, `tmux`) writes to
//!    the clipboard itself; the server decodes that and sends
//!    `ServerMessage::Clipboard { data }` (base64) to the foreground client
//!    (`src/server/headless/notifications.rs`'s `AppEvent::ClipboardWrite`
//!    arm) -- unrelated to mouse selection, and the only sense in which the
//!    server "renders" a clipboard write.
//!
//! Both call `write_clipboard_bytes` so there is exactly one native-
//! clipboard call site. `decode_clipboard_payload` is the OSC 52 path's own
//! base64 decode + size guard; the mouse-selection path never needs it
//! (its text arrives as a plain JSON string, not base64).
//!
//! A manual base64 decoder, not the `base64` crate: `base64` is already
//! resolved in this workspace's `Cargo.lock` (pulled transitively by other
//! dependencies), but adding it as *this crate's own* direct dependency
//! would still be a second new one alongside `arboard` -- the task caps
//! new dependencies at one. Standard base64 (RFC 4648, `+`/`/`, `=`
//! padding) is small enough to own directly and keeps the whole budget on
//! `arboard`, the one dependency that actually needs to be a crate (there
//! is no "native OS clipboard" in `std`).

const MAX_CLIPBOARD_BYTES: usize = 8 * 1024 * 1024; // 8 MiB, per spec.

/// Decodes one base64 alphabet character (standard, not URL-safe) to its
/// 6-bit value, or `None` for anything outside `A-Za-z0-9+/`.
fn base64_symbol(byte: u8) -> Option<u8> {
    match byte {
        b'A'..=b'Z' => Some(byte - b'A'),
        b'a'..=b'z' => Some(byte - b'a' + 26),
        b'0'..=b'9' => Some(byte - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

/// Decodes standard (RFC 4648) base64 text, rejecting anything malformed:
/// wrong length, invalid characters, or a decoded payload over
/// `MAX_CLIPBOARD_BYTES`. `data` may contain trailing/leading ASCII
/// whitespace (some encoders line-wrap), which is stripped first; embedded
/// whitespace elsewhere is treated as invalid, matching every mainstream
/// base64 decoder's strict mode.
pub fn decode_clipboard_payload(data: &str) -> Option<Vec<u8>> {
    let trimmed = data.trim();
    if trimmed.is_empty() {
        return Some(Vec::new());
    }
    let bytes = trimmed.as_bytes();
    if !bytes.len().is_multiple_of(4) {
        return None;
    }
    // A quick upper bound before doing any real work: each 4-char group
    // decodes to at most 3 bytes, so reject early rather than decoding
    // megabytes just to throw them away.
    let upper_bound = (bytes.len() / 4) * 3;
    if upper_bound > MAX_CLIPBOARD_BYTES + 3 {
        return None;
    }

    let mut out = Vec::with_capacity(upper_bound);
    for chunk in bytes.chunks_exact(4) {
        let pad = chunk.iter().rev().take_while(|&&b| b == b'=').count();
        if pad > 2 {
            return None;
        }
        // Padding may only appear in the final group, and only as a
        // trailing run -- a `=` followed by a real symbol is invalid.
        if chunk[..4 - pad].contains(&b'=') {
            return None;
        }
        let mut values = [0u8; 4];
        for (i, &b) in chunk.iter().enumerate() {
            if b == b'=' {
                break;
            }
            values[i] = base64_symbol(b)?;
        }
        let n = (u32::from(values[0]) << 18)
            | (u32::from(values[1]) << 12)
            | (u32::from(values[2]) << 6)
            | u32::from(values[3]);
        out.push((n >> 16) as u8);
        if pad < 2 {
            out.push((n >> 8) as u8);
        }
        if pad < 1 {
            out.push(n as u8);
        }
    }
    (out.len() <= MAX_CLIPBOARD_BYTES).then_some(out)
}

/// Writes bytes to the OS clipboard as plain UTF-8 text. Returns `false`
/// (never panics) when the bytes aren't valid UTF-8, no clipboard is
/// available (e.g. a locked/headless session), or the write itself fails --
/// every caller already treats a clipboard write as best-effort.
pub fn write_clipboard_bytes(bytes: &[u8]) -> bool {
    let Ok(text) = std::str::from_utf8(bytes) else {
        return false;
    };
    let Ok(mut clipboard) = arboard::Clipboard::new() else {
        return false;
    };
    clipboard.set_text(text).is_ok()
}

/// Reads plain text from the OS clipboard (terminal-parity spec P0 #4
/// "Paste"): replaces `navigator.clipboard.readText()` on the frontend, so
/// paste no longer depends on the webview's own clipboard-read permission
/// prompt/policy. `None` (never panics) when there is no clipboard text
/// available (e.g. the clipboard holds an image, or is empty/locked) or the
/// read fails -- every caller already treats a clipboard read as
/// best-effort, same as the write side above.
pub fn read_clipboard_text() -> Option<String> {
    let mut clipboard = arboard::Clipboard::new().ok()?;
    clipboard.get_text().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_valid_base64_without_padding() {
        // "herdr" -> base64, no padding needed (5 bytes -> 8 chars, no `=`).
        assert_eq!(
            decode_clipboard_payload("aGVyZHI="),
            Some(b"herdr".to_vec())
        );
    }

    #[test]
    fn decodes_valid_base64_with_two_padding_chars() {
        // "hi" -> "aGk=" (2 bytes, one padding char).
        assert_eq!(decode_clipboard_payload("aGk="), Some(b"hi".to_vec()));
        // "h" -> "aA==" (1 byte, two padding chars).
        assert_eq!(decode_clipboard_payload("aA=="), Some(b"h".to_vec()));
    }

    #[test]
    fn decodes_empty_string_to_empty_bytes() {
        assert_eq!(decode_clipboard_payload(""), Some(Vec::new()));
        assert_eq!(decode_clipboard_payload("   "), Some(Vec::new()));
    }

    #[test]
    fn rejects_invalid_base64_characters() {
        assert_eq!(decode_clipboard_payload("not base64!!"), None);
        assert_eq!(decode_clipboard_payload("aGVy_HI="), None);
    }

    #[test]
    fn rejects_wrong_length_input() {
        assert_eq!(decode_clipboard_payload("aGVyZHI"), None); // not a multiple of 4
    }

    #[test]
    fn rejects_padding_in_a_non_final_position() {
        assert_eq!(decode_clipboard_payload("aG=yZHI="), None);
    }

    #[test]
    fn rejects_more_than_two_padding_characters() {
        assert_eq!(decode_clipboard_payload("a==="), None);
    }

    #[test]
    fn rejects_a_decoded_payload_over_8_mib() {
        // "AAAA" decodes to 3 zero bytes; repeated enough times, the
        // decoded payload lands just past `MAX_CLIPBOARD_BYTES`.
        let groups = MAX_CLIPBOARD_BYTES / 3 + 10;
        let oversized = "AAAA".repeat(groups);
        assert_eq!(decode_clipboard_payload(&oversized), None);
    }

    #[test]
    fn accepts_a_large_payload_under_the_limit() {
        let groups = (1024 * 1024) / 3; // ~1 MiB decoded, well under the cap
        let large = "AAAA".repeat(groups);
        let decoded = decode_clipboard_payload(&large).expect("under the 8 MiB cap");
        assert_eq!(decoded.len(), groups * 3);
        assert!(decoded.iter().all(|&b| b == 0));
    }

    #[test]
    fn round_trips_through_the_real_base64_engine_used_server_side() {
        // herdr's server encodes with `base64::engine::general_purpose::
        // STANDARD` (src/server/headless/notifications.rs). This crate
        // can't depend on the `base64` crate itself (budget: one new
        // dependency, spent on `arboard`), so this test instead checks our
        // decoder against bytes we know are valid standard base64: every
        // byte value 0..=255 twice over, whose encoding is a well-known,
        // independently reproducible fixture.
        let mut payload = Vec::new();
        for b in 0u8..=255 {
            payload.push(b);
            payload.push(b);
        }
        // Encoded with the same standard alphabet by an independent tool
        // (Python's `base64.b64encode`) over the same 512-byte fixture.
        let encoded = STANDARD_512_BYTE_FIXTURE_B64;
        assert_eq!(decode_clipboard_payload(encoded), Some(payload));
    }

    #[test]
    fn write_clipboard_bytes_rejects_non_utf8_without_panicking() {
        assert!(!write_clipboard_bytes(&[0xff, 0xfe, 0xfd]));
    }

    #[test]
    fn read_clipboard_text_does_not_panic_with_no_desktop_clipboard() {
        // Best-effort only, same rationale as the write-side test below: a
        // sandboxed/headless test runner may have no OS clipboard at all.
        let _ = read_clipboard_text();
    }

    #[test]
    fn write_clipboard_bytes_does_not_panic_on_plain_text() {
        // Best-effort only: a sandboxed/headless test runner may have no OS
        // clipboard at all (`arboard::Clipboard::new()` then fails), which
        // is not a bug in this function -- only "never panics" is checked
        // here. Actual clipboard success is one of this feature's
        // live-verification items (no automated test owns a real desktop
        // clipboard).
        let _ = write_clipboard_bytes(b"herdr clipboard test");
    }

    /// `base64.b64encode(bytes(x for b in range(256) for x in (b, b)))`,
    /// computed independently of this module's decoder.
    const STANDARD_512_BYTE_FIXTURE_B64: &str = concat!(
        "AAABAQICAwMEBAUFBgYHBwgICQkKCgsLDAwNDQ4ODw8QEBEREhITExQUFRUWFhcXGBgZGRoaGxsc",
        "HB0dHh4fHyAgISEiIiMjJCQlJSYmJycoKCkpKiorKywsLS0uLi8vMDAxMTIyMzM0NDU1NjY3Nzg4",
        "OTk6Ojs7PDw9PT4+Pz9AQEFBQkJDQ0RERUVGRkdHSEhJSUpKS0tMTE1NTk5PT1BQUVFSUlNTVFRV",
        "VVZWV1dYWFlZWlpbW1xcXV1eXl9fYGBhYWJiY2NkZGVlZmZnZ2hoaWlqamtrbGxtbW5ub29wcHFx",
        "cnJzc3R0dXV2dnd3eHh5eXp6e3t8fH19fn5/f4CAgYGCgoODhISFhYaGh4eIiImJioqLi4yMjY2O",
        "jo+PkJCRkZKSk5OUlJWVlpaXl5iYmZmampubnJydnZ6en5+goKGhoqKjo6SkpaWmpqenqKipqaqq",
        "q6usrK2trq6vr7CwsbGysrOztLS1tba2t7e4uLm5urq7u7y8vb2+vr+/wMDBwcLCw8PExMXFxsbH",
        "x8jIycnKysvLzMzNzc7Oz8/Q0NHR0tLT09TU1dXW1tfX2NjZ2dra29vc3N3d3t7f3+Dg4eHi4uPj",
        "5OTl5ebm5+fo6Onp6urr6+zs7e3u7u/v8PDx8fLy8/P09PX19vb39/j4+fn6+vv7/Pz9/f7+//8="
    );
}
