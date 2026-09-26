//! `SurfaceMirror`: the backend's authoritative copy of the current
//! composited grid for one connection's active tab (spec §4, §1 "Patch
//! acceptance rule").
//!
//! `apply_full`/`apply_patch` port the exact 9-condition acceptance rule
//! from herdr's `src/client/shell/surface_patch.rs:33-169`. The tests in
//! this module encode the expected behavior from spec §1.

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
    /// Not one of herdr's numbered conditions: the GUI's own defensive
    /// guard against a corrupted/malicious full frame whose `cells.len()`
    /// doesn't match `width * height`. Applying such a frame would panic
    /// later on out-of-bounds cell indexing (code review finding #3);
    /// treat it like any other rejection so the caller resyncs instead.
    CellCountMismatch,
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
    /// Whether the last applied full frame carried a popup. The mirror has
    /// no `popup` field of its own (Phase 1 never renders one), so this
    /// tracks rejection condition 5 across patches (`current.popup.is_some()`
    /// in `src/client/shell/surface_patch.rs`).
    had_popup: bool,
    /// Whether the last applied full frame's graphics scene had any
    /// placements or retained assets. Tracks rejection condition 6.
    had_graphics: bool,
}

/// Geometry equality for rejection condition 8: `pane_id, rect, inner_rect,
/// focused, pixel_width, pixel_height` (`surface_patch.rs:96-106`).
fn pane_geometry_matches(left: &PaneSurfacePane, right: &PaneSurfacePane) -> bool {
    left.pane_id == right.pane_id
        && left.rect == right.rect
        && left.inner_rect == right.inner_rect
        && left.focused == right.focused
        && left.pixel_width == right.pixel_width
        && left.pixel_height == right.pixel_height
}

/// Whether `row` fits within the mirror's `width`/`height`
/// (`src/client/shell/surface_patch.rs`'s `row_fits_frame`).
fn row_fits_frame(row: &herdr_wire::PaneSurfacePatchRow, width: u16, height: u16) -> bool {
    row.x
        .saturating_add(row.cells.len().min(u16::MAX as usize) as u16)
        <= width
        && row.y < height
}

/// Whether `row` falls inside `rect` as a scrollbar column (a single-cell
/// wide column of `rect.width`, spanning some of `rect.height`'s rows).
fn row_in_rect_as_scrollbar(
    row: &herdr_wire::PaneSurfacePatchRow,
    rect: herdr_wire::SurfaceRect,
) -> bool {
    row.x == rect.x
        && row.y >= rect.y
        && row.y < rect.y.saturating_add(rect.height)
        && row.cells.len() == usize::from(rect.width)
}

/// Whether `row` lies inside `pane`'s `inner_rect`, or (as a fallback) its
/// `scrollbar_rect` -- or, if that doesn't match, `current`'s
/// `scrollbar_rect` (`src/client/shell/surface_patch.rs:140-169`).
/// `scrollbar_rect` isn't part of the pane-geometry-equality check (#8 in
/// `pane_geometry_matches`), so a patch's pane may carry a different (or
/// absent) `scrollbar_rect` than the mirror's current pane of the same
/// `pane_id`; herdr falls back to the current pane's `scrollbar_rect` in
/// that case, and this must match.
fn row_in_pane(
    row: &herdr_wire::PaneSurfacePatchRow,
    pane: &PaneSurfacePane,
    current: Option<&PaneSurfacePane>,
) -> bool {
    let inner = pane.inner_rect;
    let terminal_row = row.x >= inner.x
        && row.y >= inner.y
        && row.y < inner.y.saturating_add(inner.height)
        && row
            .x
            .saturating_add(row.cells.len().min(u16::MAX as usize) as u16)
            <= inner.x.saturating_add(inner.width);
    let scrollbar_row = pane
        .scrollbar_rect
        .is_some_and(|rect| row_in_rect_as_scrollbar(row, rect))
        || current
            .and_then(|p| p.scrollbar_rect)
            .is_some_and(|rect| row_in_rect_as_scrollbar(row, rect));
    terminal_row || scrollbar_row
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
            had_popup: false,
            had_graphics: false,
        }
    }

    pub fn has_surface(&self) -> bool {
        !self.boot_id.is_empty()
    }

    /// Replaces the mirror wholesale from a full `PaneSurfaceFrame`. Never
    /// rejected by herdr's own acceptance rule (§1), but the GUI additionally
    /// rejects a frame whose `cells.len()` doesn't match `width * height`
    /// (`Rejected::CellCountMismatch`): applying it would leave `self.cells`
    /// inconsistent with `self.width`/`self.height`, and a later patch could
    /// then index past the end of `cells` (finding #3). The caller must
    /// treat this like a rejected patch and resync.
    pub fn apply_full(&mut self, frame: PaneSurfaceFrame) -> Result<Delta, Rejected> {
        let expected_cells = usize::from(frame.frame.width) * usize::from(frame.frame.height);
        if frame.frame.cells.len() != expected_cells {
            return Err(Rejected::CellCountMismatch);
        }
        self.boot_id = frame.boot_id;
        self.projection_revision = frame.projection_revision;
        self.surface_revision = frame.surface_revision;
        self.width = frame.frame.width;
        self.height = frame.frame.height;
        self.cells = frame.frame.cells;
        self.panes = frame.panes;
        self.cursor = frame.frame.cursor;
        // Condition 5/6 are tracked implicitly: a full frame's popup/graphics
        // state is not stored on the mirror (Phase 1 never renders them), so
        // remember whether the *source frame* carried either, to reproduce
        // the TUI's rejection behavior on the next patch.
        self.had_popup = frame.popup.is_some();
        self.had_graphics =
            !frame.graphics.placements.is_empty() || !frame.graphics.retained_assets.is_empty();
        Ok(Delta::Full)
    }

    /// Applies an incremental patch, or rejects it per spec §1's nine
    /// conditions. A rejection must leave `self` completely unchanged
    /// (`src/client/shell/surface_patch.rs:33-169`).
    pub fn apply_patch(&mut self, patch: PaneSurfacePatch) -> Result<Delta, Rejected> {
        // 1. There is no current surface.
        if !self.has_surface() {
            return Err(Rejected::NoCurrentSurface);
        }
        // 2. `boot_id` or `projection_revision` differs.
        if patch.boot_id != self.boot_id || patch.projection_revision != self.projection_revision {
            return Err(Rejected::BootOrProjectionMismatch);
        }
        // 3. `base_surface_revision != current.surface_revision`.
        if patch.base_surface_revision != self.surface_revision {
            return Err(Rejected::BaseRevisionMismatch);
        }
        // 4. `surface_revision != current.surface_revision + 1`.
        if patch.surface_revision != self.surface_revision.saturating_add(1) {
            return Err(Rejected::RevisionNotMonotonic);
        }
        // 5. The current surface has an active popup.
        if self.had_popup {
            return Err(Rejected::PopupPresent);
        }
        // 6. The current surface's graphics scene has placements or
        //    retained assets.
        if self.had_graphics {
            return Err(Rejected::GraphicsSceneNonEmpty);
        }
        // 7/8. Every patched pane must match an existing pane_id and have
        //      unchanged geometry.
        for updated in &patch.panes {
            let Some(existing) = self
                .panes
                .iter()
                .find(|pane| pane.pane_id == updated.pane_id)
            else {
                return Err(Rejected::UnknownPaneId);
            };
            if !pane_geometry_matches(existing, updated) {
                return Err(Rejected::PaneGeometryChanged);
            }
        }
        // 9. Every row must fit the frame and lie inside a patched pane's
        //    inner_rect (or its scrollbar_rect, falling back to the current
        //    pane's scrollbar_rect -- see `row_in_pane`).
        for row in &patch.rows {
            let in_a_patched_pane = patch.panes.iter().any(|pane| {
                let current = self.panes.iter().find(|p| p.pane_id == pane.pane_id);
                row_in_pane(row, pane, current)
            });
            let start = usize::from(row.y) * usize::from(self.width) + usize::from(row.x);
            let end = start.saturating_add(row.cells.len());
            if !row_fits_frame(row, self.width, self.height)
                || row.cells.is_empty()
                || !in_a_patched_pane
                // Defensive, matching herdr's own `end > cells.len()` guard
                // (`src/client/shell/surface_patch.rs:26`): `row_fits_frame`
                // already implies this whenever `self.cells.len() ==
                // self.width * self.height` (guaranteed by `apply_full`'s
                // `CellCountMismatch` guard), but never index past the end
                // of `cells` even if that invariant were ever violated.
                || end > self.cells.len()
            {
                return Err(Rejected::RowOutOfBounds);
            }
        }

        // Apply: overwrite the row spans, replace the matching panes, set
        // the cursor, and bump the revision.
        for row in &patch.rows {
            let start = usize::from(row.y) * usize::from(self.width) + usize::from(row.x);
            let end = start + row.cells.len();
            self.cells[start..end].clone_from_slice(&row.cells);
        }
        for updated in &patch.panes {
            if let Some(existing) = self
                .panes
                .iter_mut()
                .find(|pane| pane.pane_id == updated.pane_id)
            {
                *existing = updated.clone();
            }
        }
        self.cursor = patch.cursor.clone();
        self.surface_revision = patch.surface_revision;

        Ok(Delta::Rows(patch.rows))
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
        mirror
            .apply_full(full_frame("boot-1", 1, 1))
            .expect("full_frame's cells.len() matches its width*height");
        mirror
    }

    #[test]
    fn full_apply_replaces_the_mirror() {
        let mut mirror = SurfaceMirror::empty();
        let delta = mirror
            .apply_full(full_frame("boot-1", 1, 1))
            .expect("full_frame's cells.len() matches its width*height");
        assert_eq!(delta, Delta::Full);
        assert_eq!(mirror.boot_id, "boot-1");
        assert_eq!(mirror.width, 4);
        assert_eq!(mirror.height, 2);
        assert_eq!(mirror.cells.len(), 8);
        assert_eq!(mirror.surface_revision, 1);
        assert!(mirror.has_surface());
    }

    #[test]
    fn apply_full_rejects_a_frame_whose_cell_count_does_not_match_width_times_height() {
        let mut mirror = SurfaceMirror::empty();
        let mut frame = full_frame("boot-1", 1, 1);
        // width=4, height=2 needs 8 cells; this frame carries only 1 (a
        // short/corrupted full frame, code review finding #3).
        frame.frame.cells = vec![cell(" ")];
        assert_eq!(mirror.apply_full(frame), Err(Rejected::CellCountMismatch));
        assert!(
            !mirror.has_surface(),
            "a rejected full frame must not replace the mirror"
        );
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
        mirror.apply_full(frame).expect("cell count still matches");
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
        mirror.apply_full(frame).expect("cell count still matches");
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
        mirror.apply_full(frame).expect("cell count still matches");
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
        mirror.apply_full(frame).expect("cell count matches");

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

    #[test]
    fn accepts_a_row_matching_the_current_panes_scrollbar_rect_when_the_patch_pane_omits_it() {
        // scrollbar_rect isn't part of pane-geometry equality (condition 8),
        // so a patch's pane may carry a different/absent scrollbar_rect than
        // the mirror's current pane. herdr falls back to the *current*
        // pane's scrollbar_rect in that case (finding #8); the old code only
        // checked the patch pane's own scrollbar_rect.
        let mut mirror = SurfaceMirror::empty();
        let scrollbar = rect(4, 0, 1, 2);
        let mut frame = full_frame("boot-1", 1, 1);
        frame.frame.width = 5;
        frame.frame.cells = vec![cell(" "); 10];
        let mut current_pane = pane("w1:p1", rect(0, 0, 4, 2));
        current_pane.rect = rect(0, 0, 5, 2);
        current_pane.scrollbar_rect = Some(scrollbar);
        frame.panes = vec![current_pane];
        mirror
            .apply_full(frame)
            .expect("cell count matches (5*2=10)");

        let mut patch = base_patch(1, 2);
        let mut patch_pane = pane("w1:p1", rect(0, 0, 4, 2));
        patch_pane.rect = rect(0, 0, 5, 2);
        patch_pane.scrollbar_rect = None; // omitted, unlike the current pane
        patch.panes = vec![patch_pane];
        patch.rows = vec![PaneSurfacePatchRow {
            x: 4,
            y: 0,
            cells: vec![cell("|")],
        }];
        let delta = mirror
            .apply_patch(patch)
            .expect("row matches the current pane's scrollbar_rect via fallback");
        assert!(matches!(delta, Delta::Rows(rows) if rows.len() == 1));
    }

    #[test]
    fn apply_patch_rejects_a_row_that_would_exceed_the_cells_buffer() {
        // Directly construct a mirror whose `cells` buffer is shorter than
        // `width * height` -- a state `apply_full`'s `CellCountMismatch`
        // guard now prevents in practice -- to exercise the row-span guard
        // defensively, matching herdr's own `end > cells.len()` check
        // (`src/client/shell/surface_patch.rs:26`, finding #3).
        let mut mirror = SurfaceMirror {
            boot_id: "boot-1".into(),
            projection_revision: 1,
            surface_revision: 1,
            width: 4,
            height: 2,
            cells: vec![cell(" ")],
            panes: vec![pane("w1:p1", rect(0, 0, 4, 2))],
            cursor: None,
            had_popup: false,
            had_graphics: false,
        };
        let before = mirror.clone();
        let patch = base_patch(1, 2);
        assert_eq!(mirror.apply_patch(patch), Err(Rejected::RowOutOfBounds));
        assert_eq!(
            mirror, before,
            "a rejected patch must not mutate the mirror"
        );
    }
}
