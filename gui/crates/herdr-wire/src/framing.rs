//! Length-prefixed framing for the herdr client protocol socket.
//!
//! Wire shape (`src/protocol/wire.rs:1662-1715`): a 4-byte **little-endian**
//! `u32` length, then a `bincode::config::standard()` payload (serde path).
//! Trailing bytes after the decoded message are an error.
//!
//! The GUI reads with a 32 MiB cap (`MAX_FRAME_SIZE` below, matching herdr's
//! `MAX_GRAPHICS_FRAME_SIZE` at `wire.rs:29`), not herdr's 2 MiB
//! `MAX_FRAME_SIZE`, because a `PaneSurface` frame carrying image assets can
//! exceed 2 MiB. A claim over the cap is not fatal: the reader discards
//! exactly `claimed_len` bytes so the stream stays in sync, then keeps
//! reading. A decode failure (`decode_server`) is likewise not fatal: the
//! frame was already fully consumed by `read_frame`, so the stream stays
//! aligned for the next frame. Both behaviors are the implementer's job;
//! this module only fixes the public API shape so the harness tests below
//! compile against it.

use std::io::{Read, Write};

use crate::client::ClientMessage;
use crate::server::ServerMessage;

/// Matches herdr's `MAX_GRAPHICS_FRAME_SIZE` (`src/protocol/wire.rs:29`),
/// which is the cap the GUI reads with (see module docs above).
pub const MAX_FRAME_SIZE: usize = 32 * 1024 * 1024;

#[derive(Debug)]
pub enum FrameError {
    /// The reader hit end-of-stream before a complete length prefix or
    /// payload could be read.
    Eof,
    /// Any other I/O failure.
    Io(std::io::Error),
}

impl std::fmt::Display for FrameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FrameError::Eof => write!(f, "unexpected end of stream"),
            FrameError::Io(err) => write!(f, "I/O error: {err}"),
        }
    }
}

impl std::error::Error for FrameError {}

impl From<std::io::Error> for FrameError {
    fn from(err: std::io::Error) -> Self {
        FrameError::Io(err)
    }
}

#[derive(Debug)]
pub enum DecodeError {
    /// Bincode failed to decode the payload as a `ServerMessage`, or the
    /// payload had trailing bytes after a successfully decoded message.
    Bincode(String),
}

impl std::fmt::Display for DecodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DecodeError::Bincode(message) => write!(f, "bincode error: {message}"),
        }
    }
}

impl std::error::Error for DecodeError {}

/// Encodes `msg` as `bincode::config::standard()` and writes it as
/// `[u32 LE length][payload]`.
pub fn write_frame<W: Write>(_writer: &mut W, _msg: &ClientMessage) -> std::io::Result<()> {
    todo!("write_frame: implement the length-prefixed bincode write described in the module docs")
}

/// Reads one length-prefixed frame and returns its raw payload bytes
/// (undecoded). Frames whose claimed length exceeds `max` are discarded
/// (their `claimed_len` bytes are consumed from `reader`) rather than
/// returned or treated as fatal; the next frame is read instead.
pub fn read_frame<R: Read>(_reader: &mut R, _max: usize) -> Result<Vec<u8>, FrameError> {
    todo!("read_frame: implement length-prefixed reads with oversize discard-and-continue")
}

/// Decodes a raw payload (as returned by `read_frame`) into a `ServerMessage`
/// using `bincode::config::standard()`. Rejects trailing bytes after the
/// decoded message, matching herdr's `read_message` (`wire.rs:1705-1718`).
pub fn decode_server(_payload: &[u8]) -> Result<ServerMessage, DecodeError> {
    todo!("decode_server: bincode-decode a ServerMessage and reject trailing bytes")
}
