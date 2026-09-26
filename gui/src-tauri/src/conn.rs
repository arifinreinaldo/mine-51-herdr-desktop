//! Connects to the herdr server's client protocol socket, performs the
//! endpoint handshake, and loops reading frames (spec §4 `conn.rs`, §1
//! "Handshake").
//!
//! Fully stubbed: connecting, handshaking, reconnecting, and dispatching are
//! real application logic, not scaffolding, and are left for the
//! implementer. `src-tauri/tests/fake_server.rs` drives this module against
//! an in-process fake herdr server and is expected to fail (red) until the
//! implementation lands.

use std::path::Path;

use herdr_wire::{ClientMessage, EndpointClientHello, ServerMessage};

/// Connection lifecycle state, surfaced to the frontend as the connection
/// banner (spec §6 "Connection banner").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionStatus {
    /// Attempting the initial connect.
    Connecting,
    /// The initial connect timed out (2s) or was refused; retrying every 2s.
    Unavailable,
    /// Connected and past the welcome handshake.
    Connected,
    /// Was connected, then got `ServerShutdown` or EOF; reconnect loop running.
    Disconnected,
}

#[derive(Debug)]
pub enum ConnError {
    /// The initial connect did not complete within the 2s timeout.
    Timeout,
    Io(std::io::Error),
    /// The server's `Welcome`/`EndpointControl` handshake reply carried an error.
    HandshakeRejected(String),
    /// The stream ended (EOF) or the server sent `ServerShutdown`.
    Closed,
}

impl std::fmt::Display for ConnError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConnError::Timeout => write!(f, "connect timed out"),
            ConnError::Io(err) => write!(f, "I/O error: {err}"),
            ConnError::HandshakeRejected(reason) => write!(f, "handshake rejected: {reason}"),
            ConnError::Closed => write!(f, "connection closed"),
        }
    }
}

impl std::error::Error for ConnError {}

/// A live connection to the herdr server's client protocol socket, past the
/// endpoint handshake.
pub struct Connection {
    _private: (),
}

impl Connection {
    /// Connects with a 2s timeout, sends `ClientMessage::EndpointControl`
    /// with kind `endpoint.hello.v1` and `hello` as its JSON payload, and
    /// waits for `endpoint.welcome.v1`. Ignores unrecognized `EndpointControl`
    /// kinds that may arrive before the welcome.
    pub async fn connect(
        socket_path: &Path,
        hello: &EndpointClientHello,
    ) -> Result<Self, ConnError> {
        let _ = (socket_path, hello);
        todo!("connect: interprocess (tokio) connect with a 2s timeout, then the endpoint.hello.v1/endpoint.welcome.v1 handshake")
    }

    /// Reads and decodes the next `ServerMessage`. A frame that fails to
    /// decode is logged (`warn!` with the variant index) and skipped, not
    /// treated as a connection error (spec §3 "A decode failure skips one
    /// frame").
    pub async fn read_message(&mut self) -> Result<ServerMessage, ConnError> {
        todo!("read_message: read_frame + decode_server in a loop, skipping frames that fail to decode, until one succeeds or the stream closes")
    }

    /// Writes one `ClientMessage` frame.
    pub async fn send(&mut self, msg: &ClientMessage) -> Result<(), ConnError> {
        let _ = msg;
        todo!("send: async write_frame over the connection")
    }

    /// Invokes one endpoint API method and returns its parsed result,
    /// correlating the reply by `request_id` and timing out after 5s.
    ///
    /// **Only one request may be in flight per connection** (the server
    /// answers a concurrent second one with `endpoint_busy`, spec §1). This
    /// method is the natural place to serialize that: callers (including
    /// `commands::api`) that invoke it concurrently must be queued here,
    /// not raced. Takes `&self` (not `&mut self`) precisely so multiple
    /// callers can hold a shared `Connection` and queue through it -- the
    /// implementation needs interior mutability (e.g. a `tokio::sync::Mutex`
    /// guarding the write half, plus a response-dispatch table keyed by
    /// `request_id`). `src-tauri/tests/fake_server.rs` drives two
    /// concurrent calls against a fake server and asserts only one
    /// `ClientShellEndpointRequest` is ever outstanding at a time.
    pub async fn endpoint_request(
        &self,
        boot_id: &str,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, ConnError> {
        let _ = (boot_id, method, params);
        todo!("endpoint_request: queue behind any in-flight request, send ClientShellEndpointRequest, correlate request_id, concatenate response chunks until final_chunk, 5s timeout")
    }
}
