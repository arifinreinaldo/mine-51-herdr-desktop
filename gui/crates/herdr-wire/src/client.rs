//! Client -> server wire types, copied verbatim from herdr's
//! `src/protocol/wire.rs` (lines ~41-695 at the time of copying).
//!
//! Field order, types, and serde attributes must stay byte-identical to the
//! herdr source: bincode encodes structs positionally and enums by variant
//! index. Do not reorder, add, or remove anything here without re-checking
//! against `src/protocol/wire.rs` in the herdr repo root.

use serde::{Deserialize, Serialize};

/// Windows console key record, copied verbatim from herdr's
/// `src/input/model.rs:6-14`. Plain serde, no `#[cfg]` gate on this type
/// itself (the *field* that holds it is always present in
/// `ClientPaneInputEvent::Key`, but the GUI always sends `None`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowsKeyRecord {
    pub key_down: bool,
    pub repeat_count: u16,
    pub virtual_key_code: u16,
    pub virtual_scan_code: u16,
    pub unicode: u16,
    pub control_key_state: u32,
}

/// Size of the pane surface requested by a client-owned shell.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClientSurfaceSize {
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClientKeyKind {
    Press,
    Repeat,
    Release,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ClientKeyCode {
    Backspace,
    Enter,
    Left,
    Right,
    Up,
    Down,
    Home,
    End,
    PageUp,
    PageDown,
    Tab,
    BackTab,
    Delete,
    Insert,
    Esc,
    Char(char),
    F(u8),
    Null,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ClientMouseButton {
    Left,
    Right,
    Middle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClientMouseKind {
    Down(ClientMouseButton),
    Up(ClientMouseButton),
    Drag(ClientMouseButton),
    Moved,
    ScrollUp,
    ScrollDown,
    ScrollLeft,
    ScrollRight,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClientMousePosition {
    Cell {
        column: u16,
        row: u16,
    },
    Pixels {
        x: u32,
        y: u32,
        column: u16,
        row: u16,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClientMouseGeometry {
    pub cols: u16,
    pub rows: u16,
    pub width_px: u32,
    pub height_px: u32,
}

/// Pane-domain input after the client has classified and consumed shell actions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClientPaneInputEvent {
    Key {
        code: ClientKeyCode,
        modifiers: u8,
        kind: ClientKeyKind,
        repeat_count: u16,
        shifted_codepoint: Option<u32>,
        generated_text: Option<String>,
        tracks_release: bool,
        physical_key_id: Option<u32>,
        windows_record: Option<WindowsKeyRecord>,
    },
    TextCommit(String),
    Mouse {
        kind: ClientMouseKind,
        position: ClientMousePosition,
        geometry: Option<ClientMouseGeometry>,
        modifiers: u8,
        lines: u16,
    },
    Paste(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClientHostColor {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClientHostDefaultColorKind {
    Foreground,
    Background,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClientHostAppearance {
    Dark,
    Light,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClientHostThemeUpdate {
    DefaultColor {
        kind: ClientHostDefaultColorKind,
        color: ClientHostColor,
    },
    PaletteColors(Vec<(u8, ClientHostColor)>),
    Appearance(ClientHostAppearance),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClientClipboardImageTarget {
    DirectTerminal,
    Pane(String),
    Popup(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AttachScrollDirection {
    Up,
    Down,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AttachScrollSource {
    Wheel,
    PageKey { input: Vec<u8> },
}

/// Messages sent from the client to the server over the client protocol socket.
///
/// Variant order is frozen for endpoint generation 1 (see
/// `src/protocol/wire.rs:465-623`). The GUI serializes only
/// `EndpointControl`, `ClientShellResize`, `ClientShellPaneInput`,
/// `ClientShellEndpointRequest`, and `ClientShellFocus`, but every variant is
/// copied with its real payload type so bincode's variant-index tags line up
/// exactly with herdr's.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClientMessage {
    /// tag 0
    TerminalHello {
        version: u32,
        cols: u16,
        rows: u16,
        cell_width_px: u32,
        cell_height_px: u32,
        pixel_mouse: bool,
    },
    /// tag 1
    Input { data: Vec<u8> },
    /// tag 2
    ClipboardImage {
        target: ClientClipboardImageTarget,
        extension: String,
        data: Vec<u8>,
    },
    /// tag 3
    Resize {
        cols: u16,
        rows: u16,
        cell_width_px: u32,
        cell_height_px: u32,
        pixel_mouse: bool,
    },
    /// tag 4
    Detach,
    /// tag 5
    AttachTerminal { terminal_id: String, takeover: bool },
    /// tag 6
    AttachScroll {
        source: AttachScrollSource,
        direction: AttachScrollDirection,
        lines: u16,
        column: Option<u16>,
        row: Option<u16>,
        modifiers: u8,
    },
    /// tag 7
    ObserveTerminal { target: String },
    /// tag 8
    ControlTerminal { target: String, takeover: bool },
    /// tag 9
    GraphicsTransmissionResult {
        transfer_id: u64,
        image_id: u32,
        success: bool,
    },
    /// tag 10
    GraphicsTransmissionStarted { transfer_id: u64, image_id: u32 },
    /// tag 11
    ClientShellHello {
        version: u32,
        cell_width_px: u32,
        cell_height_px: u32,
        surface_size: ClientSurfaceSize,
        pixel_mouse: bool,
        direct_graphics: bool,
        endpoint_keybindings: bool,
        mouse_capture: bool,
    },
    /// tag 12 -- sent by the GUI
    ClientShellResize {
        cell_width_px: u32,
        cell_height_px: u32,
        surface_size: ClientSurfaceSize,
        pixel_mouse: bool,
    },
    /// tag 13 -- sent by the GUI
    ClientShellPaneInput {
        pane_id: String,
        events: Vec<ClientPaneInputEvent>,
    },
    /// tag 14
    ClientShellPopupInput {
        terminal_id: String,
        events: Vec<ClientPaneInputEvent>,
    },
    /// tag 15 -- sent by the GUI
    ClientShellEndpointRequest { boot_id: String, request: String },
    /// tag 16
    AttachMouse {
        kind: ClientMouseKind,
        position: ClientMousePosition,
        geometry: Option<ClientMouseGeometry>,
        modifiers: u8,
        lines: u16,
    },
    /// tag 17
    ClientShellHostTheme { update: ClientHostThemeUpdate },
    /// tag 18 -- sent by the GUI
    ClientShellFocus { focused: bool },
    /// tag 19
    ClientShellMouseCapture { enabled: bool },
    /// tag 20 -- sent by the GUI (handshake, and all endpoint API commands)
    EndpointControl { kind: String, data: String },
}
