# Why Cowbell uses herdr's endpoint protocol

## The protocol

Cowbell speaks herdr's generation-1 client endpoint protocol. The code lives
in `crates/herdr-wire`. This crate copies herdr's own
`src/protocol/wire.rs`. `crates/herdr-wire/NOTICE` records the copy and its
licence.

## Why generation 1 is a safe base

herdr documents generation 1 as stable. The doc comment in
`src/protocol/endpoint.rs` states the rule: generation 1 is the
compatibility floor for Local, SSH, and Cloud shell endpoints. It must stay
available. herdr can retire it only for a security reason. herdr's own
socket-api docs repeat this rule under "Protocol stability".

## Why not the CLI socket API

herdr recommends its CLI socket API for most third-party bridges. That API
suits scripts and simple integrations well. Cowbell needs more than that.

Cowbell renders a composited terminal surface. It streams input back with
low latency. The endpoint protocol carries both directly. The CLI socket
API does not expose the composited surface stream in the same way.

## The risk, and how Cowbell handles it

A future herdr release can retire generation 1. herdr allows this only for
a security reason. This is unlikely, but not impossible.

If a version mismatch happens, herdr rejects the handshake. Cowbell already
handles this case. The connection layer reports it as
`ConnError::HandshakeRejected` (`src-tauri/src/conn.rs`). Cowbell shows its
existing handshake error to the user. No new error path is needed for this
risk.
