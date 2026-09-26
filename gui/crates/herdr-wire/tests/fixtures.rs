//! Parses herdr's frozen generation-1 endpoint fixtures into `herdr-wire`'s
//! JSON types and round-trips them. Read from the herdr repo root by
//! relative path, per spec §9.2: this crate lives at
//! `<repo>/gui/crates/herdr-wire`, so the fixtures are three levels up.

use herdr_wire::{ClientShellSnapshot, EndpointClientHello, EndpointServerWelcome};

const HELLO_FIXTURE: &str = include_str!("../../../../tests/fixtures/endpoint-hello-v1.json");
const WELCOME_FIXTURE: &str = include_str!("../../../../tests/fixtures/endpoint-welcome-v1.json");
const SNAPSHOT_FIXTURE: &str = include_str!("../../../../tests/fixtures/endpoint-snapshot-v1.json");

#[test]
fn hello_fixture_parses_and_round_trips() {
    let hello: EndpointClientHello = serde_json::from_str(HELLO_FIXTURE).expect("parse hello");
    assert!(hello.supports_required_codecs());
    assert_eq!(hello.generation, 1);
    assert!(hello.mouse_capture);
    assert!(!hello.direct_graphics);

    let value = serde_json::to_value(&hello).expect("serialize hello");
    let round_tripped: EndpointClientHello =
        serde_json::from_value(value).expect("round-trip hello");
    assert_eq!(hello, round_tripped);
}

#[test]
fn hello_fixture_tolerates_unknown_fields() {
    let mut value: serde_json::Value = serde_json::from_str(HELLO_FIXTURE).unwrap();
    value["future_feature"] = serde_json::json!({"enabled": true});
    let decoded: EndpointClientHello = serde_json::from_value(value).expect("tolerate unknowns");
    assert!(decoded.supports_required_codecs());
}

#[test]
fn welcome_fixture_parses_and_round_trips() {
    let welcome: EndpointServerWelcome =
        serde_json::from_str(WELCOME_FIXTURE).expect("parse welcome");
    assert_eq!(welcome.generation, 1);
    assert_eq!(welcome.snapshot_codec, "shell.snapshot.v1");
    assert_eq!(welcome.surface_codec, "shell.surface.v1");
    assert_eq!(welcome.input_codec, "shell.input.semantic.v1");
    assert_eq!(welcome.blob_codec, "shell.blob.v1");
    assert!(welcome.error.is_none());

    let value = serde_json::to_value(&welcome).expect("serialize welcome");
    let round_tripped: EndpointServerWelcome =
        serde_json::from_value(value).expect("round-trip welcome");
    assert_eq!(welcome, round_tripped);
}

#[test]
fn welcome_fixture_tolerates_unknown_fields() {
    let mut value: serde_json::Value = serde_json::from_str(WELCOME_FIXTURE).unwrap();
    value["future_service"] = serde_json::json!("v2");
    let decoded: EndpointServerWelcome = serde_json::from_value(value).expect("tolerate unknowns");
    assert_eq!(decoded.generation, 1);
}

#[test]
fn snapshot_fixture_parses_and_round_trips() {
    let snapshot: ClientShellSnapshot =
        serde_json::from_str(SNAPSHOT_FIXTURE).expect("parse snapshot");
    assert_eq!(snapshot.boot_id, "boot-v1");
    assert_eq!(snapshot.revision, 7);
    assert_eq!(snapshot.workspaces.len(), 1);
    assert_eq!(snapshot.tabs.len(), 1);
    assert_eq!(snapshot.panes.len(), 1);
    assert_eq!(snapshot.agents.len(), 1);
    assert_eq!(snapshot.commands.len(), 1);

    let value = serde_json::to_value(&snapshot).expect("serialize snapshot");
    let round_tripped: ClientShellSnapshot =
        serde_json::from_value(value).expect("round-trip snapshot");
    assert_eq!(snapshot, round_tripped);
}

/// The fixture's `agent_status: "future_status_from_new_server"` on the
/// workspace must decode to `Unknown` through the custom deserializer
/// (`wire.rs:901-918`), never fail to parse.
#[test]
fn snapshot_fixture_unknown_agent_status_becomes_unknown() {
    let snapshot: ClientShellSnapshot =
        serde_json::from_str(SNAPSHOT_FIXTURE).expect("parse snapshot");
    assert_eq!(
        snapshot.workspaces[0].agent_status,
        herdr_wire::AgentStatus::Unknown
    );
    // The tab and agent in the same fixture use known statuses, proving the
    // deserializer isn't just defaulting everything to Unknown.
    assert_eq!(
        snapshot.tabs[0].agent_status,
        herdr_wire::AgentStatus::Working
    );
    assert_eq!(
        snapshot.agents[0].agent_status,
        herdr_wire::AgentStatus::Blocked
    );
}

#[test]
fn snapshot_fixture_tolerates_unknown_top_level_fields() {
    let mut value: serde_json::Value = serde_json::from_str(SNAPSHOT_FIXTURE).unwrap();
    value["future_projection"] = serde_json::json!({"enabled": true});
    let decoded: ClientShellSnapshot = serde_json::from_value(value).expect("tolerate unknowns");
    assert_eq!(decoded.boot_id, "boot-v1");
}

/// A future `ClientShellCommandAction` value must fall back to `Unknown`
/// (`#[serde(other)]`, `wire.rs:975-984`) rather than fail to parse.
#[test]
fn snapshot_fixture_unknown_command_action_becomes_unknown() {
    let mut value: serde_json::Value = serde_json::from_str(SNAPSHOT_FIXTURE).unwrap();
    value["commands"] = serde_json::json!([{
        "command_id": "future",
        "binding_label": "x",
        "binding_labels": ["x"],
        "action": "FutureAction",
        "description": null,
    }]);
    let decoded: ClientShellSnapshot = serde_json::from_value(value).expect("parse");
    assert_eq!(
        decoded.commands[0].action,
        herdr_wire::ClientShellCommandAction::Unknown
    );
}
