# Screenshot preview modal: design spec

Mode: Operate. The user takes a screenshot to paste it somewhere. Speed and predictability outrank expression. The incumbent styling is the authority: `src/ui/modal.ts`, `.modal*` in `src/style.css`, `.run-btn`, `.btn`, codicons, theme tokens. Add no new colours, fonts or shadows.

## 1. Entry point

- A Screenshot button in the run toolbar, right of Mirror. Class `run-btn run-btn--shot`, codicon `device-camera`.
- Title (tooltip): `Screenshot <device name>`. Disabled with the same rule as Mirror (no ready device).
- Click opens the modal at once, in the Capturing state. The capture takes 0.5 to 1.5 s. An instant modal feels faster than a delayed one.

## 2. Layout

Reuse `openModal("Screenshot", …)`. Add a variant class `modal--shot` on the `.modal` element.

- `.modal--shot`: `width: auto; max-width: 92vw; max-height: none; overflow: visible`. The default 480 px width and `70vh` scroll would crop a 9:20 phone image.
- Body: two columns, `display: flex; gap: 16px; align-items: flex-start`.
- **Left, preview frame.** Background `--terminal-background`, `1px solid --menu-border`, radius 4px, padding 0. The image uses `max-height: min(70vh, 640px); max-width: 360px; width: auto; height: auto; display: block`. The image never scales above its natural size. A 1080×2400 shot shows about 288×640 px on a tall window.
- **Right, action column.** Width 148 px, `display: flex; flex-direction: column; gap: 8px`.
  1. **Copy** (primary): `codicon-copy`, filled with `--button-background` / `--button-foreground`.
  2. **Save as…** (secondary): `codicon-save-as`, existing `.btn` outline style.
  3. **Close** (ghost, pushed to the bottom with `margin-top: auto`): `codicon-close`, `.btn`.
  - Every button has a visible text label plus an icon. Buttons fill the column width, left-aligned, 22 px high like `.run-btn`, `font-size: 12px`.
  - Under the buttons, a meta block in `--descriptionForeground`, `font-size: var(--fs-xs)`, `font-variant-numeric: tabular-nums`. Three lines: device name, `1080 × 2400`, capture time `14:32:07`.
- Fit check: 640 px image plus title and padding is about 706 px. At a 600 px window the image drops to 420 px (`70vh`). Nothing scrolls at either size.

## 3. States

| State | Preview frame | Buttons | Notes |
|---|---|---|---|
| Capturing | Placeholder with `aspect-ratio: 9 / 20`, width 200 px, centred `codicon-loading codicon-modifier-spin` and the text `Capturing…` | Copy and Save disabled (`opacity: 0.4`, like `.run-btn:disabled`); Close active | Meta shows the device name only |
| Ready | Image fades in, 120 ms (same timing as `#copy-notice`) | All active | Initial focus on Copy |
| Copying / Saving | Unchanged | The pressed button shows a spinner and stays disabled | Usually under 200 ms |
| Copied | Unchanged | Copy label becomes `Copied` with `codicon-check` in `--herdr-status-done` for 1600 ms, then it reverts | The modal stays open, so the user can also save |
| Saved | Unchanged | Save label becomes `Saved` with the same check for 1600 ms; the meta block gains the file name (full path in `title`) | A cancelled file dialog changes nothing and shows no error |
| Copy or save failed | Unchanged | Buttons return to normal | One inline line under the buttons in `--herdr-danger`, `--fs-xs`, `role="alert"` |
| Capture failed | Frame shows `codicon-error` in `--herdr-danger` and the adb message (max 3 lines, ellipsis, full text in `title`) | **Retry** (primary) replaces Copy; Save is hidden; Close stays | Unauthorised or offline device: the message says to accept the USB prompt |
| Black frame | Image shows as normal | All active | A hint line under the preview: `The screen looks black. The phone may be locked, or the app blocks screenshots.` See §6 |

## 4. Keyboard and focus

- `Esc` closes. `openModal` already does this, and it returns focus to the terminal.
- Tab order: Copy, Save as…, Close. Focus ring: `outline: 1px solid var(--focusBorder)`, the same as `.shortcuts-modal-search:focus`.
- `Enter` or `Space` on a focused button activates it.
- While the modal is open: `Ctrl+C` copies the image and `Ctrl+S` opens Save as…. Both call `preventDefault`. They are ignored while a text selection exists inside the modal (there is none today).
- Button tooltips show the shortcut: `Copy image to clipboard (Ctrl+C)`, `Save as… (Ctrl+S)`.
- Clicking the backdrop closes the modal (existing behaviour).

## 5. Accessibility

- The `.modal` element gets `role="dialog"`, `aria-modal="true"` and `aria-labelledby` pointing at the `h2`. `openModal` sets none of these today. Set them from the body builder through `body.parentElement`, so the other modals stay unchanged.
- Image `alt`: `Screenshot of <device name>, 1080 by 2400 pixels`.
- One visually hidden `aria-live="polite"` region announces `Screenshot ready`, `Copied to clipboard`, `Saved <file name>` and errors.
- Colour is never the only signal: every state change also changes the label or icon. Text contrast comes from the existing tokens.
- `@media (prefers-reduced-motion: reduce)`: no image fade. The codicon spinner is the existing one.

## 6. Notes and limits

- **Copy uses the full-resolution PNG**, not the scaled preview.
- **Save default:** `Pictures\Cowbell\screenshot-YYYYMMDD-HHMMSS.png`. The folder is created if it is missing.
- **Black-frame hint:** draw the image into a 16×36 canvas and test the mean luminance (below 3 of 255). About 10 lines, no Rust. Cut it if it slips.
- **Not in v1:** Retake, Show in folder, zoom, annotate. The request names three actions. Retake is the most likely next addition, one button in the same column.
- **Toasts:** notices (`z-index: 200`) stay above the modal (`100`), but this modal reports everything inline, so it needs no toast.
- **Falsifiable:** if the side-by-side layout feels cramped in a narrow Cowbell window, below about 540 px stack the actions under the preview as one row of three buttons.
