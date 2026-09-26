//! Connects to the herdr server's client protocol socket, performs the
//! endpoint handshake, and loops reading frames (spec §4 `conn.rs`, §1
//! "Handshake").
//!
//! Framing here is the async (tokio) counterpart of `herdr_wire::framing`
//! (spec §3: "Async variants for tokio are allowed in `src-tauri` on top of
//! these"): `herdr_wire::{read_frame, write_frame}` are synchronous
//! (`std::io::{Read, Write}`), so this module reimplements the same
//! length-prefixed-bincode wire shape directly against
//! `tokio::io::{AsyncRead, AsyncWrite}`, then hands the decoded payload to
//! the shared, synchronous `herdr_wire::decode_server`.
//!
//! Only one task ever reads the socket: a background task spawned by
//! `connect()` after the handshake. It demultiplexes every decoded
//! `ServerMessage`: a `ClientShellEndpointResponseChunk` is routed to the
//! matching `endpoint_request` caller (by `request_id`) through a
//! response-dispatch table; everything else is forwarded to an internal
//! channel that `read_message` drains. This lets `endpoint_request` take
//! `&self` (so `commands::api` and the caller of `read_message` can share
//! one `Connection`) without two tasks racing to read the same stream.

use std::collections::HashMap;
use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use herdr_wire::{
    ClientMessage, EndpointClientHello, EndpointServerWelcome, ServerMessage, ENDPOINT_HELLO_KIND,
    ENDPOINT_WELCOME_KIND, MAX_FRAME_SIZE,
};
use interprocess::local_socket::tokio::prelude::*;
use interprocess::local_socket::tokio::{RecvHalf, SendHalf};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::{mpsc, oneshot, Mutex as AsyncMutex};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

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
    /// An `api()` endpoint request's reply carried `{"error": {code, message}}`.
    EndpointError {
        code: String,
        message: String,
    },
}

impl std::fmt::Display for ConnError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConnError::Timeout => write!(f, "connect timed out"),
            ConnError::Io(err) => write!(f, "I/O error: {err}"),
            ConnError::HandshakeRejected(reason) => write!(f, "handshake rejected: {reason}"),
            ConnError::Closed => write!(f, "connection closed"),
            ConnError::EndpointError { code, message } => write!(f, "{code}: {message}"),
        }
    }
}

impl std::error::Error for ConnError {}

impl From<std::io::Error> for ConnError {
    fn from(err: std::io::Error) -> Self {
        ConnError::Io(err)
    }
}

/// Resolves `path` into the `interprocess` local-socket name used to
/// connect, matching herdr's own `src/ipc.rs::connect_local_stream`
/// cfg-gating (Windows named pipes vs. Unix filesystem sockets).
fn local_socket_name(path: &Path) -> io::Result<interprocess::local_socket::Name<'static>> {
    #[cfg(windows)]
    {
        use interprocess::local_socket::{GenericNamespaced, ToNsName};
        path.to_string_lossy()
            .to_string()
            .to_ns_name::<GenericNamespaced>()
    }
    #[cfg(unix)]
    {
        use interprocess::local_socket::{GenericFilePath, ToFsName};
        path.to_path_buf().to_fs_name::<GenericFilePath>()
    }
}

/// Writes one `ClientMessage` frame: `[u32 LE length][bincode payload]`
/// (spec §1 "Framing"), over any async writer.
async fn write_frame_async<W: AsyncWrite + Unpin>(
    writer: &mut W,
    msg: &ClientMessage,
) -> Result<(), ConnError> {
    let payload = bincode::serde::encode_to_vec(msg, bincode::config::standard())
        .map_err(|err| ConnError::Io(io::Error::other(err.to_string())))?;
    let len: u32 = payload
        .len()
        .try_into()
        .map_err(|_| ConnError::Io(io::Error::other("payload too large")))?;
    writer.write_all(&len.to_le_bytes()).await?;
    writer.write_all(&payload).await?;
    Ok(())
}

/// Reads one length-prefixed frame, discarding (and continuing past) claims
/// over `max` bytes, exactly like `herdr_wire::read_frame` (spec §1/§3).
fn map_read_error(err: std::io::Error) -> ConnError {
    if err.kind() == std::io::ErrorKind::UnexpectedEof {
        ConnError::Closed
    } else {
        ConnError::Io(err)
    }
}

async fn read_frame_async<R: AsyncRead + Unpin>(
    reader: &mut R,
    max: usize,
) -> Result<Vec<u8>, ConnError> {
    loop {
        let mut len_buf = [0u8; 4];
        reader
            .read_exact(&mut len_buf)
            .await
            .map_err(map_read_error)?;
        let claimed_len = u32::from_le_bytes(len_buf) as usize;

        if claimed_len > max {
            let mut remaining = claimed_len;
            let mut buf = [0u8; 64 * 1024];
            while remaining > 0 {
                let take = remaining.min(buf.len());
                reader
                    .read_exact(&mut buf[..take])
                    .await
                    .map_err(map_read_error)?;
                remaining -= take;
            }
            continue;
        }

        let mut payload = vec![0u8; claimed_len];
        reader
            .read_exact(&mut payload)
            .await
            .map_err(map_read_error)?;
        return Ok(payload);
    }
}

/// Reads and decodes the next frame. `Ok(None)` means the frame failed to
/// decode (already fully consumed) and the caller should read again (spec
/// §3 "A decode failure skips one frame").
async fn read_one<R: AsyncRead + Unpin>(
    reader: &mut R,
    max: usize,
) -> Result<Option<ServerMessage>, ConnError> {
    let payload = read_frame_async(reader, max).await?;
    match herdr_wire::decode_server(&payload) {
        Ok(msg) => Ok(Some(msg)),
        Err(err) => {
            tracing::warn!(
                first_byte = payload.first().copied(),
                "decode_server failed, skipping one frame: {err}"
            );
            Ok(None)
        }
    }
}

/// One `endpoint_request` call's response-in-progress: the chunks received
/// so far, and the sender it fulfills once `final_chunk` arrives.
struct PendingEndpointRequest {
    buffer: Vec<u8>,
    reply: oneshot::Sender<Vec<u8>>,
}

/// A live connection to the herdr server's client protocol socket, past the
/// endpoint handshake.
pub struct Connection {
    write_half: AsyncMutex<SendHalf>,
    inbox: AsyncMutex<mpsc::UnboundedReceiver<Result<ServerMessage, ConnError>>>,
    pending: Arc<StdMutex<HashMap<String, PendingEndpointRequest>>>,
    /// Serializes `endpoint_request` calls: only one `ClientShellEndpointRequest`
    /// may be in flight per connection (spec §1); concurrent callers queue here.
    request_gate: AsyncMutex<()>,
    next_request_id: AtomicU64,
    reader_task: tokio::task::JoinHandle<()>,
}

impl Drop for Connection {
    fn drop(&mut self) {
        self.reader_task.abort();
    }
}

impl Connection {
    /// Locks `pending`, recovering from a poisoned lock instead of
    /// panicking on every later call (finding #14).
    fn pending_lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, PendingEndpointRequest>> {
        self.pending.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Connects with a 2s timeout, sends `ClientMessage::EndpointControl`
    /// with kind `endpoint.hello.v1` and `hello` as its JSON payload, and
    /// waits for `endpoint.welcome.v1`. Ignores unrecognized `EndpointControl`
    /// kinds that may arrive before the welcome.
    pub async fn connect(
        socket_path: &Path,
        hello: &EndpointClientHello,
    ) -> Result<Self, ConnError> {
        let (recv, send) = match tokio::time::timeout(
            CONNECT_TIMEOUT,
            Self::handshake(socket_path, hello),
        )
        .await
        {
            Ok(result) => result?,
            Err(_) => return Err(ConnError::Timeout),
        };

        let (tx, rx) = mpsc::unbounded_channel();
        let pending: Arc<StdMutex<HashMap<String, PendingEndpointRequest>>> =
            Arc::new(StdMutex::new(HashMap::new()));
        let reader_task = tokio::spawn(Self::run_reader(recv, tx, pending.clone()));

        Ok(Self {
            write_half: AsyncMutex::new(send),
            inbox: AsyncMutex::new(rx),
            pending,
            request_gate: AsyncMutex::new(()),
            next_request_id: AtomicU64::new(0),
            reader_task,
        })
    }

    async fn handshake(
        socket_path: &Path,
        hello: &EndpointClientHello,
    ) -> Result<(RecvHalf, SendHalf), ConnError> {
        let name = local_socket_name(socket_path)?;
        let stream = LocalSocketStream::connect(name).await?;
        let (mut recv, mut send) = stream.split();

        let hello_json =
            serde_json::to_string(hello).map_err(|err| ConnError::Io(io::Error::other(err)))?;
        write_frame_async(
            &mut send,
            &ClientMessage::EndpointControl {
                kind: ENDPOINT_HELLO_KIND.to_string(),
                data: hello_json,
            },
        )
        .await?;

        loop {
            match read_one(&mut recv, MAX_FRAME_SIZE).await? {
                None => continue,
                Some(ServerMessage::EndpointControl { kind, data })
                    if kind == ENDPOINT_WELCOME_KIND =>
                {
                    let welcome: EndpointServerWelcome = serde_json::from_str(&data)
                        .map_err(|err| ConnError::Io(io::Error::other(err)))?;
                    if let Some(err) = welcome.error {
                        return Err(ConnError::HandshakeRejected(err.message));
                    }
                    return Ok((recv, send));
                }
                // Any other message (including an unrecognized
                // EndpointControl kind) before the welcome is ignored.
                Some(_) => continue,
            }
        }
    }

    /// The sole reader of the socket after the handshake. Demultiplexes
    /// `ClientShellEndpointResponseChunk` into the pending-request table;
    /// forwards everything else to `inbox` for `read_message`.
    async fn run_reader(
        mut recv: RecvHalf,
        tx: mpsc::UnboundedSender<Result<ServerMessage, ConnError>>,
        pending: Arc<StdMutex<HashMap<String, PendingEndpointRequest>>>,
    ) {
        loop {
            match read_one(&mut recv, MAX_FRAME_SIZE).await {
                Ok(None) => continue,
                Ok(Some(ServerMessage::ClientShellEndpointResponseChunk {
                    request_id,
                    final_chunk,
                    data,
                    ..
                })) => {
                    let mut table = pending.lock().unwrap_or_else(|e| e.into_inner());
                    if let Some(entry) = table.get_mut(&request_id) {
                        entry.buffer.extend_from_slice(&data);
                    }
                    // Re-check (rather than `unwrap()` the `get_mut` above)
                    // so a chunk for a request nobody is waiting on (a
                    // late/duplicate chunk, or one this table never held)
                    // never panics on server-driven data (finding #14).
                    if final_chunk {
                        if let Some(entry) = table.remove(&request_id) {
                            let _ = entry.reply.send(entry.buffer);
                        }
                    }
                }
                Ok(Some(msg)) => {
                    if tx.send(Ok(msg)).is_err() {
                        // Nobody is calling read_message anymore.
                        break;
                    }
                }
                Err(err) => {
                    let _ = tx.send(Err(err));
                    break;
                }
            }
        }
        // The connection died: wake every still-pending endpoint_request
        // caller by dropping their reply senders.
        pending.lock().unwrap_or_else(|e| e.into_inner()).clear();
    }

    /// Reads and decodes the next `ServerMessage`. A frame that fails to
    /// decode is logged (`warn!` with the variant index) and skipped, not
    /// treated as a connection error (spec §3 "A decode failure skips one
    /// frame").
    ///
    /// Takes `&self` (like `endpoint_request`): `inbox` is already guarded
    /// by its own async mutex, so `Connection` as a whole can live behind
    /// one `Arc` shared between the app's background dispatch loop (which
    /// alone should actually call this in a loop) and the Tauri commands
    /// that call `send`/`endpoint_request` -- without an outer lock that
    /// would otherwise have to stay held across this call's potentially
    /// long await (idle periods between server messages).
    pub async fn read_message(&self) -> Result<ServerMessage, ConnError> {
        let mut inbox = self.inbox.lock().await;
        match inbox.recv().await {
            Some(Ok(msg)) => Ok(msg),
            Some(Err(err)) => Err(err),
            None => Err(ConnError::Closed),
        }
    }

    /// Writes one `ClientMessage` frame.
    pub async fn send(&self, msg: &ClientMessage) -> Result<(), ConnError> {
        self.write_frame(msg).await
    }

    async fn write_frame(&self, msg: &ClientMessage) -> Result<(), ConnError> {
        let mut guard = self.write_half.lock().await;
        write_frame_async(&mut *guard, msg).await
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
        // Serializes concurrent callers: only one request is ever in
        // flight on this connection at a time.
        let _gate = self.request_gate.lock().await;

        let request_id = format!(
            "gui-req-{}",
            self.next_request_id.fetch_add(1, Ordering::SeqCst)
        );
        let request_json = serde_json::json!({
            "id": request_id,
            "method": method,
            "params": params,
        })
        .to_string();

        let (reply_tx, reply_rx) = oneshot::channel();
        self.pending_lock().insert(
            request_id.clone(),
            PendingEndpointRequest {
                buffer: Vec::new(),
                reply: reply_tx,
            },
        );

        let request = ClientMessage::ClientShellEndpointRequest {
            boot_id: boot_id.to_string(),
            request: request_json,
        };
        if let Err(err) = self.write_frame(&request).await {
            self.pending_lock().remove(&request_id);
            return Err(err);
        }

        let bytes = match tokio::time::timeout(REQUEST_TIMEOUT, reply_rx).await {
            Ok(Ok(bytes)) => bytes,
            Ok(Err(_)) => return Err(ConnError::Closed),
            Err(_) => {
                self.pending_lock().remove(&request_id);
                return Err(ConnError::Timeout);
            }
        };

        let value: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|err| ConnError::Io(io::Error::other(err)))?;
        if let Some(error) = value.get("error") {
            let code = error
                .get("code")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            let message = error
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            return Err(ConnError::EndpointError { code, message });
        }
        Ok(value
            .get("result")
            .cloned()
            .unwrap_or(serde_json::Value::Null))
    }
}
