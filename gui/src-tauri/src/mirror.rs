//! `SurfaceMirror`: the backend's authoritative copy of the current
//! composited grid for one connection's active tab (spec §4, §1 "Patch
//! acceptance rule").
//!
//! `apply_full`/`apply_patch` are stubbed with `todo!()`: porting the exact
//! 9-condition acceptance rule from herdr's
//! `src/client/shell/surface_patch.rs:33-169` is real application logic, not
//! scaffolding, and is left for the implementer. The tests in this module
//! encode the expected behavior from spec §1 and are expected to fail (red)
//! until that port lands.

use herdr_wire::{CursorState, PaneSurfaceFrame, PaneSurfacePane, PaneSurfacePatch};

/// A single cell in the mirror's grid. Reuses `herdr_wire::CellData`
/// directly: there is no mirror-specific cell representation in Phase 1.
pub type Cell = herdr_wire::CellData;

/// What changed as a result of applying a full frame or an accepted patch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Delta {
    /// A full frame replaced the entire grid.
    Full,
    /// An accepted patch changed only these rows (already re-based onto the
    /// mirror's absolute coordinates).
    Rows(Vec<herdr_wire::PaneSurfacePatchRow>),
}

/// Why a patch was rejected, matching spec §1's nine numbered conditions
/// (`src/client/shell/surface_patch.rs:33-169`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Rejected {
    /// 1. There is no current surface (the mirror has never seen a full frame).
    NoCurrentSurface,
    /// 2. `boot_id` or `projection_revision` differs from the current surface.
    BootOrProjectionMismatch,
    /// 3. `base_surface_revision != current.surface_revision`.
    BaseRevisionMismatch,
    /// 4. `surface_revision != current.surface_revision + 1`.
    RevisionNotMonotonic,
    /// 5. The current surface has an active popup.
    PopupPresent,
    /// 6. The current surface's graphics scene has placements or retained assets.
    GraphicsSceneNonEmpty,
    /// 7. A patched pane's `pane_id` is missing from the current panes.
    UnknownPaneId,
    /// 8. A patched pane's geometry changed (`pane_id, rect, inner_rect,
    ///    focused, pixel_width, pixel_height`).
    PaneGeometryChanged,
    /// 9. A row is empty, exceeds `frame.width`/`height`, or lies outside
    ///    every patched pane's `inner_rect`/`scrollbar_rect`.
    RowOutOfBounds,
}

/// The backend's authoritative mirror of the current composited grid.
///
/// `SurfaceMirror::empty()` is the sentinel "no surface yet" state (rejection
/// condition 1): `boot_id` is empty and there are no cells. The mirror
/// becomes a real surface only after the first successful `apply_full`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SurfaceMirror {
    pub boot_id: String,
    pub projection_revision: u64,
    pub surface_revision: u64,
    pub width: u16,
    pub height: u16,
    pub cells: Vec<Cell>,
    pub panes: Vec<PaneSurfacePane>,
    pub cursor: Option<CursorState>,
}

impl SurfaceMirror {
    /// The sentinel "no surface yet" state. See rejection condition 1.
    pub fn empty() -> Self {
        Self {
            boot_id: String::new(),
            projection_revision: 0,
            surface_revision: 0,
            width: 0,
            height: 0,
            cells: Vec::new(),
            panes: Vec::new(),
            cursor: None,
        }
    }

    pub fn has_surface(&self) -> bool {
        !self.boot_id.is_empty()
    }

    /// Replaces the mirror wholesale from a full `PaneSurfaceFrame`. Always
    /// succeeds: a full frame is never rejected.
    pub fn apply_full(&mut self, frame: PaneSurfaceFrame) -> Delta {
        let _ = frame;
        todo!("apply_full: replace boot_id/projection_revision/surface_revision/width/height/cells/panes/cursor from `frame`")
    }

    /// Applies an incremental patch, or rejects it per spec §1's nine
    /// conditions. A rejection must leave `self` completely unchanged.
    pub fn apply_patch(&mut self, patch: PaneSurfacePatch) -> Result<Delta, Rejected> {
        let _ = patch;
        todo!("apply_patch: port src/client/shell/surface_patch.rs:33-169 exactly (see Rejected's doc comments for the 9 conditions)")
    }
}

impl Default for SurfaceMirror {
    fn default() -> Self {
        Self::empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use herdr_wire::{CellData, FrameData, PaneSurfacePatchRow, SurfaceGraphicsScene, SurfaceRect};

    fn rect(x: u16, y: u16, width: u16, height: u16) -> SurfaceRect {
        SurfaceRect {
            x,
            y,
            width,
            height,
        }
    }

    fn cell(symbol: &str) -> CellData {
        CellData {
            symbol: symbol.into(),
            fg: 0,
            bg: 0,
            modifier: 0,
            skip: false,
            hyperlink: None,
        }
    }

    fn pane(id: &str, inner: SurfaceRect) -> PaneSurfacePane {
        PaneSurfacePane {
            pane_id: id.into(),
            content_revision: 1,
            rect: inner,
            inner_rect: inner,
            scrollbar_rect: None,
            scroll: None,
            focused: true,
            mouse_reporting: false,
            sgr_pixel_mouse: false,
            alternate_screen_active: false,
            pixel_width: 0,
            pixel_height: 0,
        }
    }

    /// A 4x2 full frame with one pane covering the whole grid.
    fn full_frame(
        boot_id: &str,
        projection_revision: u64,
        surface_revision: u64,
    ) -> PaneSurfaceFrame {
        PaneSurfaceFrame {
            boot_id: boot_id.into(),
            projection_revision,
            surface_revision,
            frame: FrameData {
                cells: vec![cell(" "); 8],
                width: 4,
                height: 2,
                cursor: Some(CursorState {
                    x: 0,
                    y: 0,
                    visible: true,
                    shape: 0,
                }),
                hyperlinks: Vec::new(),
                graphics: Vec::new(),
            },
            panes: vec![pane("w1:p1", rect(0, 0, 4, 2))],
            splits: Vec::new(),
            popup: None,
            graphics: SurfaceGraphicsScene::default(),
        }
    }

    fn base_patch(base_surface_revision: u64, surface_revision: u64) -> PaneSurfacePatch {
        PaneSurfacePatch {
            boot_id: "boot-1".into(),
            projection_revision: 1,
            base_surface_revision,
            surface_revision,
            rows: vec![PaneSurfacePatchRow {
                x: 0,
                y: 0,
                cells: vec![cell("x"), cell("y")],
            }],
            panes: vec![pane("w1:p1", rect(0, 0, 4, 2))],
            cursor: Some(CursorState {
                x: 1,
                y: 0,
                visible: true,
                shape: 0,
            }),
        }
    }

    fn mirror_after_full_frame() -> SurfaceMirror {
        let mut mirror = SurfaceMirror::empty();
        mirror.apply_full(full_frame("boot-1", 1, 1));
        mirror
    }

    #[test]
    fn full_apply_replaces_the_mirror() {
        let mut mirror = SurfaceMirror::empty();
        let delta = mirror.apply_full(full_frame("boot-1", 1, 1));
        assert_eq!(delta, Delta::Full);
        assert_eq!(mirror.boot_id, "boot-1");
        assert_eq!(mirror.width, 4);
        assert_eq!(mirror.height, 2);
        assert_eq!(mirror.cells.len(), 8);
        assert_eq!(mirror.surface_revision, 1);
        assert!(mirror.has_surface());
    }

    #[test]
    fn accepted_patch_overwrites_rows_replaces_panes_and_sets_cursor_and_revision() {
        let mut mirror = mirror_after_full_frame();
        let mut patch = base_patch(1, 2);
        // Same pane_id/geometry (so this isn't a geometry-change rejection),
        // but a bumped content_revision, so "replaces matching panes" is
        // actually observable rather than a no-op overwrite with identical data.
        patch.panes[0].content_revision = 2;
        let delta = mirror
            .apply_patch(patch)
            .expect("base_surface_revision == current, surface_revision == current+1");
        assert!(matches!(delta, Delta::Rows(rows) if rows.len() == 1));
        assert_eq!(mirror.surface_revision, 2);
        assert_eq!(
            mirror.cursor,
            Some(CursorState {
                x: 1,
                y: 0,
                visible: true,
                shape: 0
            })
        );
        assert_eq!(mirror.cells[0].symbol, "x");
        assert_eq!(mirror.cells[1].symbol, "y");
        assert_eq!(
            mirror.panes[0].content_revision, 2,
            "apply_patch must replace the matching pane's metadata, not just leave the old one"
        );
    }

    #[test]
    fn rejects_when_there_is_no_current_surface() {
        let mut mirror = SurfaceMirror::empty();
        let result = mirror.apply_patch(base_patch(0, 1));
        assert_eq!(result, Err(Rejected::NoCurrentSurface));
    }

    #[test]
    fn rejects_when_boot_id_differs() {
        let mut mirror = mirror_after_full_frame();
        let mut patch = base_patch(1, 2);
        patch.boot_id = "boot-2".into();
        assert_eq!(
            mirror.apply_patch(patch),
            Err(Rejected::BootOrProjectionMismatch)
        );
    }

    #[test]
    fn rejects_when_projection_revision_differs() {
        let mut mirror = mirror_after_full_frame();
        let mut patch = base_patch(1, 2);
        patch.projection_revision = 2;
        assert_eq!(
            mirror.apply_patch(patch),
            Err(Rejected::BootOrProjectionMismatch)
        );
    }

    #[test]
    fn rejects_when_base_surface_revision_mismatches() {
        let mut mirror = mirror_after_full_frame();
        let patch = base_patch(0, 2); // current.surface_revision is 1, not 0
        assert_eq!(
            mirror.apply_patch(patch),
            Err(Rejected::BaseRevisionMismatch)
        );
    }

    #[test]
    fn rejects_when_surface_revision_is_not_current_plus_one() {
        let mut mirror = mirror_after_full_frame();
        let patch = base_patch(1, 3); // should be 2, not 3
        assert_eq!(
            mirror.apply_patch(patch),
            Err(Rejected::RevisionNotMonotonic)
        );
    }

    #[test]
    fn rejects_when_popup_is_present() {
        // The mirror struct itself has no popup field (Phase 1 never
        // renders one), so this condition is exercised through apply_full
        // carrying a populated popup and then patching against it.
        let mut mirror = SurfaceMirror::empty();
        let mut frame = full_frame("boot-1", 1, 1);
        frame.popup = Some(Box::new(herdr_wire::ClientShellPopupSurface {
            terminal_id: "popup-1".into(),
            title: "popup".into(),
            width: None,
            height: None,
            frame: FrameData {
                cells: Vec::new(),
                width: 0,
                height: 0,
                cursor: None,
                hyperlinks: Vec::new(),
                graphics: Vec::new(),
            },
            mouse_reporting: false,
            sgr_pixel_mouse: false,
            pixel_width: 0,
            pixel_height: 0,
        }));
        mirror.apply_full(frame);
        assert_eq!(
            mirror.apply_patch(base_patch(1, 2)),
            Err(Rejected::PopupPresent)
        );
    }

    #[test]
    fn rejects_when_graphics_placements_are_present() {
        let mut mirror = SurfaceMirror::empty();
        let mut frame = full_frame("boot-1", 1, 1);
        let key = herdr_wire::SurfaceGraphicsAssetKey {
            source: herdr_wire::SurfaceGraphicsSource::Terminal {
                target: herdr_wire::SurfaceGraphicsTarget::Pane {
                    pane_id: "w1:p1".into(),
                },
                image_id: 1,
            },
            image_width: 1,
            image_height: 1,
            format: herdr_wire::SurfaceGraphicsFormat::Rgba,
            data_len: 4,
            data_fingerprint: 1,
        };
        frame
            .graphics
            .placements
            .push(herdr_wire::SurfaceGraphicsPlacement {
                asset: key,
                logical_placement_id: 1,
                x: 0,
                y: 0,
                cols: 1,
                rows: 1,
                source_x: 0,
                source_y: 0,
                source_width: 1,
                source_height: 1,
                x_offset: 0,
                y_offset: 0,
                z: 0,
                scrollback_offset: 0,
            });
        mirror.apply_full(frame);
        assert_eq!(
            mirror.apply_patch(base_patch(1, 2)),
            Err(Rejected::GraphicsSceneNonEmpty)
        );
    }

    #[test]
    fn rejects_when_graphics_retained_assets_are_present() {
        let mut mirror = SurfaceMirror::empty();
        let mut frame = full_frame("boot-1", 1, 1);
        frame
            .graphics
            .retained_assets
            .push(herdr_wire::SurfaceGraphicsAssetKey {
                source: herdr_wire::SurfaceGraphicsSource::Terminal {
                    target: herdr_wire::SurfaceGraphicsTarget::Pane {
                        pane_id: "w1:p1".into(),
                    },
                    image_id: 1,
                },
                image_width: 1,
                image_height: 1,
                format: herdr_wire::SurfaceGraphicsFormat::Rgba,
                data_len: 4,
                data_fingerprint: 1,
            });
        mirror.apply_full(frame);
        assert_eq!(
            mirror.apply_patch(base_patch(1, 2)),
            Err(Rejected::GraphicsSceneNonEmpty)
        );
    }

    #[test]
    fn rejects_when_patch_references_an_unknown_pane_id() {
        let mut mirror = mirror_after_full_frame();
        let mut patch = base_patch(1, 2);
        patch.panes = vec![pane("w1:does-not-exist", rect(0, 0, 4, 2))];
        assert_eq!(mirror.apply_patch(patch), Err(Rejected::UnknownPaneId));
    }

    #[test]
    fn rejects_when_patched_pane_geometry_changed() {
        let mut mirror = mirror_after_full_frame();
        let mut patch = base_patch(1, 2);
        // Same pane_id, different rect: geometry equality is
        // pane_id/rect/inner_rect/focused/pixel_width/pixel_height.
        patch.panes = vec![pane("w1:p1", rect(0, 0, 2, 2))];
        assert_eq!(
            mirror.apply_patch(patch),
            Err(Rejected::PaneGeometryChanged)
        );
    }

    #[test]
    fn rejects_when_a_row_is_empty() {
        let mut mirror = mirror_after_full_frame();
        let mut patch = base_patch(1, 2);
        patch.rows = vec![PaneSurfacePatchRow {
            x: 0,
            y: 0,
            cells: Vec::new(),
        }];
        assert_eq!(mirror.apply_patch(patch), Err(Rejected::RowOutOfBounds));
    }

    #[test]
    fn rejects_when_a_row_exceeds_frame_bounds() {
        let mut mirror = mirror_after_full_frame();
        let mut patch = base_patch(1, 2);
        // Frame width is 4; x=3 plus 2 cells reaches column 5.
        patch.rows = vec![PaneSurfacePatchRow {
            x: 3,
            y: 0,
            cells: vec![cell("a"), cell("b")],
        }];
        assert_eq!(mirror.apply_patch(patch), Err(Rejected::RowOutOfBounds));
    }

    #[test]
    fn rejects_when_a_row_lies_outside_the_patched_panes_inner_rect() {
        let mut mirror = SurfaceMirror::empty();
        // Two side-by-side panes; the patch only lists the left one, but the
        // row falls entirely inside the right one.
        let mut frame = full_frame("boot-1", 1, 1);
        frame.panes = vec![
            pane("w1:left", rect(0, 0, 2, 2)),
            pane("w1:right", rect(2, 0, 2, 2)),
        ];
        mirror.apply_full(frame);

        let mut patch = base_patch(1, 2);
        patch.panes = vec![pane("w1:left", rect(0, 0, 2, 2))];
        patch.rows = vec![PaneSurfacePatchRow {
            x: 2,
            y: 0,
            cells: vec![cell("a"), cell("b")],
        }];
        assert_eq!(mirror.apply_patch(patch), Err(Rejected::RowOutOfBounds));
    }

    #[test]
    fn rejection_leaves_the_grid_unchanged() {
        let mut mirror = mirror_after_full_frame();
        let before = mirror.clone();
        let mut bad_patch = base_patch(1, 2);
        bad_patch.boot_id = "boot-2".into();
        assert!(mirror.apply_patch(bad_patch).is_err());
        assert_eq!(
            mirror, before,
            "a rejected patch must not mutate the mirror"
        );
    }
}
