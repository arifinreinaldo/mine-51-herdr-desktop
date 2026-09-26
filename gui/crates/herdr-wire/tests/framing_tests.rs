//! Framing behavior tests (spec §9.3). `write_frame`/`read_frame`/
//! `decode_server` are stubbed with `todo!()` in `framing.rs` -- these tests
//! encode the expected behavior and are expected to fail (panic) until an
//! implementer fills in the bodies. They must still compile.

use herdr_wire::{decode_server, read_frame, write_frame, ClientMessage, ServerMessage};

fn detach() -> ClientMessage {
    ClientMessage::Detach
}

fn welcome() -> ServerMessage {
    ServerMessage::Welcome {
        version: 22,
        encoding: herdr_wire::RenderEncoding::SemanticFrame,
        error: None,
    }
}

fn le_len_prefixed(payload: &[u8]) -> Vec<u8> {
    let mut buf = (payload.len() as u32).to_le_bytes().to_vec();
    buf.extend_from_slice(payload);
    buf
}

#[test]
fn write_frame_uses_le_length_prefix() {
    let mut buf = Vec::new();
    write_frame(&mut buf, &detach()).expect("write frame");
    assert!(
        buf.len() >= 4,
        "frame must at least contain the length prefix"
    );
    let claimed_len = u32::from_le_bytes(buf[..4].try_into().unwrap()) as usize;
    assert_eq!(
        claimed_len,
        buf.len() - 4,
        "LE length prefix must match the payload size"
    );
}

#[test]
fn read_frame_round_trips_a_client_message() {
    let mut buf = Vec::new();
    write_frame(&mut buf, &detach()).expect("write frame");
    let payload = read_frame(&mut buf.as_slice(), herdr_wire::MAX_FRAME_SIZE).expect("read frame");
    // `Detach` is a unit variant at tag 4: bincode encodes it as a single
    // varint byte with no further payload.
    let expected = bincode::serde::encode_to_vec(&detach(), bincode::config::standard()).unwrap();
    assert_eq!(payload, expected);
}

#[test]
fn decode_server_round_trips_a_welcome() {
    let payload = bincode::serde::encode_to_vec(&welcome(), bincode::config::standard()).unwrap();
    let decoded = decode_server(&payload).expect("decode welcome");
    assert_eq!(decoded, welcome());
}

#[test]
fn decode_server_rejects_trailing_bytes() {
    let mut payload =
        bincode::serde::encode_to_vec(&welcome(), bincode::config::standard()).unwrap();
    payload.push(0xDE);
    assert!(decode_server(&payload).is_err());
}

#[test]
fn read_frame_rejects_oversized_claim_without_panicking() {
    // Claim far more than the 32 MiB cap; a tiny custom `max` keeps the
    // test fast without allocating anywhere near 32 MiB.
    let mut buf = (10_000_000u32).to_le_bytes().to_vec();
    buf.extend_from_slice(&[0xAA; 16]); // far short of the claimed length
    let result = read_frame(&mut buf.as_slice(), 64);
    assert!(
        result.is_err(),
        "an oversized claim must not be returned as a payload"
    );
}

/// A decode failure must not desynchronize the stream: the frame is
/// length-delimited, so a bad payload's bytes are fully consumed by
/// `read_frame` even though `decode_server` rejects them, and the next
/// frame reads normally.
#[test]
fn bad_payload_between_two_good_frames_leaves_the_stream_readable() {
    let mut stream = Vec::new();
    write_frame(&mut stream, &detach()).unwrap();
    stream.extend_from_slice(&le_len_prefixed(&[0xDE, 0xAD, 0xBE, 0xEF, 0x01, 0x02]));
    write_frame(&mut stream, &detach()).unwrap();

    let mut cursor = stream.as_slice();

    let first = read_frame(&mut cursor, herdr_wire::MAX_FRAME_SIZE).expect("first good frame");
    let expected_detach =
        bincode::serde::encode_to_vec(&detach(), bincode::config::standard()).unwrap();
    assert_eq!(first, expected_detach);

    let bad = read_frame(&mut cursor, herdr_wire::MAX_FRAME_SIZE)
        .expect("bad payload still reads as bytes");
    assert!(
        decode_server(&bad).is_err(),
        "garbage payload must fail to decode"
    );

    let third = read_frame(&mut cursor, herdr_wire::MAX_FRAME_SIZE)
        .expect("stream stays readable after a bad payload");
    assert_eq!(third, expected_detach);
}

/// Spec §1/§3: a claim over the reader's `max` is not fatal by itself --
/// `read_frame` discards exactly `claimed_len` bytes and keeps reading, so
/// an oversized frame between two good ones does not break the stream.
#[test]
fn oversize_frame_between_two_good_frames_leaves_the_stream_readable() {
    let max = 64usize;
    let mut stream = Vec::new();
    write_frame(&mut stream, &detach()).unwrap();
    // A claim larger than `max`, with exactly that many discardable bytes
    // following it so the stream stays aligned for the next real frame.
    let oversized_claim = (max as u32) + 1;
    let mut oversized_frame = oversized_claim.to_le_bytes().to_vec();
    oversized_frame.extend(vec![0u8; oversized_claim as usize]);
    stream.extend_from_slice(&oversized_frame);
    write_frame(&mut stream, &detach()).unwrap();

    let mut cursor = stream.as_slice();
    let expected_detach =
        bincode::serde::encode_to_vec(&detach(), bincode::config::standard()).unwrap();

    let first = read_frame(&mut cursor, max).expect("first good frame");
    assert_eq!(first, expected_detach);

    // The oversized frame must be transparently skipped: this call should
    // yield the *next* real frame, not an error and not the oversized one.
    let after_oversize =
        read_frame(&mut cursor, max).expect("stream stays readable after an oversized claim");
    assert_eq!(after_oversize, expected_detach);
}
