# Protocol - how the GUI talks to herdr

> This is the only page about herdr. The herdr core source is out of scope.

## Facts
- Cowbell speaks the herdr generation-1 endpoint protocol (`docs/protocol-choice.md:5`).
- `crates/herdr-wire` copies the herdr wire types. It must stay byte-identical (`crates/herdr-wire/src/client.rs:1-7`).
- `ENDPOINT_PROTOCOL_GENERATION` is 1 (`crates/herdr-wire/src/endpoint.rs:10`). Do not change generation-1 fields (`crates/herdr-wire/src/endpoint.rs:1-5`).
- The wire crate has no tokio dependency. Async I/O lives in `src-tauri/src/conn.rs` (`crates/herdr-wire/src/lib.rs:4-6`).

## Socket path
`socket.rs` resolves the path in this order (`src-tauri/src/socket.rs:5-9`):
1. `HERDR_SOCKET_PATH`, which gives `<stem>-client.sock`.
2. `HERDR_CLIENT_SOCKET_PATH`, used as written.
3. `HERDR_SESSION`, which gives `sessions/<name>/herdr-client.sock`.
4. `<config_dir>/herdr-client.sock`.

## Connection
- `Connection::connect` opens the socket and does the handshake (`src-tauri/src/conn.rs:233`, `src-tauri/src/conn.rs:263`).
- One reader task reads all frames. It routes endpoint replies by `request_id` (`src-tauri/src/conn.rs:305`).
- `initial_hello` builds the hello message (`src-tauri/src/dispatch.rs:38`).
- `run_reconnect_loop` reconnects every 2 s (`src-tauri/src/dispatch.rs:83`, `src-tauri/src/dispatch.rs:29`).
- `commands::api` sends one method and waits 5 s (`src-tauri/src/commands.rs:260-272`).
- A rejected surface patch triggers a same-size resize to resync (`src-tauri/src/dispatch.rs:340`).

## Server process
- `engine.rs` finds the herdr binary with `locate_herdr` (`src-tauri/src/engine.rs:175`).
- `engine.rs` installs herdr on request and starts the server (`src-tauri/src/engine.rs:642`, `src-tauri/src/engine.rs:659`).

## Edges
- A change to a copied wire type breaks the bincode layout. Re-check against the herdr source first.
- Test sessions must not touch the real herdr. See `scripts/assert-gui-test-session.mjs`.
