//! Wire protocol types and framing for the herdr GUI client, copied (not
//! linked) from herdr's `src/protocol/wire.rs` and `src/protocol/endpoint.rs`.
//!
//! This crate intentionally depends on neither `ratatui` nor `tokio`: no
//! ratatui type is on the wire, and the async I/O layer belongs in
//! `src-tauri`'s `conn.rs`, built on top of the synchronous framing API here.

pub mod client;
pub mod endpoint;
pub mod framing;
pub mod server;

pub use client::*;
pub use endpoint::*;
pub use framing::{
    decode_server, read_frame, write_frame, DecodeError, FrameError, MAX_FRAME_SIZE,
};
pub use server::*;
