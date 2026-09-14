# Reelform — UI Design Guide for Claude Design

> **How to use this file:** Paste this whole document into Claude Design as the brief. It defines the product, the design system, and **every screen and state** the app has. Generate artboards screen-by-screen in the order listed in §4. Each screen section tells you the frame size, layout regions, every control, and every state that must be drawn. Do not invent features that are not listed here; do not skip any that are.

Working product name: **Reelform** (placeholder — brand can be swapped, keep the token system).
Category: desktop screen recorder + demo-video editor (macOS, Windows, Linux).
Reference quality bar: Screen Studio, Cap, OpenScreen, Linear, Arc. Calm, dense, professional, dark-first.

---

## 1. Product summary (what the UI must serve)

Reelform records a display, a window, or a region — with mic, system audio, and webcam — then opens an editor that automatically makes the footage look designed: smooth auto-zooms that follow the cursor, a polished animated cursor, a styled background frame, a webcam bubble, annotations, captions, speed ramps, trims. Exports MP4 / GIF / WebM. Saves `.reelform` project files.

**Three windows, one overlay layer:**

1. **Launcher** (small window) — start a recording, open recent projects.
2. **Recording overlays** — source picker, region selector, countdown, floating control pill, webcam bubble.
3. **Editor** (large window) — preview canvas, inspector, timeline, export.
4. **Settings** (medium window) — preferences, shortcuts, updates, extensions.

Plus system tray / menu bar item, dialogs, toasts.

---

## 2. Design system

### 2.1 Principles

- **Dark-first, light supported.** Every screen has both themes. Editor is used for hours; contrast must be comfortable (no pure black, no pure white).
- **Content is the hero.** The preview canvas is the brightest, most saturated thing on screen. Chrome is desaturated.
- **Density like a pro tool, clarity like a consumer app.** 13px base text in editor panels, 14px in launcher/settings. Generous but not wasteful padding.
- **Direct manipulation.** Anything visual (zoom region, webcam bubble, crop, annotation) can be dragged on the canvas or timeline. Inspector panels are the precise alternative, never the only way.
- **Never block.** Long tasks (export, caption generation, model download) show inline progress and let the user keep editing.
- **Motion is meaningful.** 150–220ms ease-out for panels and popovers; spring for timeline items snapping; zero motion on the timeline scrubber (must feel instant).

### 2.2 Color tokens

Define as CSS variables. Provide both themes.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg-app` | `#0F1115` | `#F4F5F7` | window background |
| `--bg-panel` | `#161A21` | `#FFFFFF` | inspector, timeline, sidebars |
| `--bg-panel-raised` | `#1C2129` | `#FFFFFF` + shadow | popovers, dialogs, cards |
| `--bg-sunken` | `#0B0D11` | `#E9EBEF` | canvas well, timeline track background |
| `--bg-hover` | `rgba(255,255,255,0.05)` | `rgba(0,0,0,0.04)` | hover on rows/buttons |
| `--bg-active` | `rgba(255,255,255,0.09)` | `rgba(0,0,0,0.07)` | pressed / selected rows |
| `--border` | `rgba(255,255,255,0.08)` | `rgba(0,0,0,0.08)` | hairlines |
| `--border-strong` | `rgba(255,255,255,0.16)` | `rgba(0,0,0,0.16)` | inputs, focused cards |
| `--text-1` | `#EDEFF3` | `#111318` | primary text |
| `--text-2` | `#A3A9B5` | `#5B6270` | secondary / labels |
| `--text-3` | `#6B7280` | `#8A909C` | placeholders, disabled |
| `--accent` | `#6E7BFF` | `#4F5BFF` | primary actions, selection, focus rings |
| `--accent-soft` | `rgba(110,123,255,0.16)` | `rgba(79,91,255,0.12)` | selected item fill |
| `--record` | `#FF4D5E` | `#E5333F` | record button, recording state, destructive |
| `--success` | `#3DD68C` | `#1FA463` | export done, permissions granted |
| `--warning` | `#FFB84D` | `#D98A0B` | fallbacks, degraded capture |
| Track colors | zoom `#6E7BFF`, speed `#FFB84D`, annotation `#3DD68C`, audio `#B57BFF`, caption `#4DD0FF`, webcam `#FF8AB3`, trim/clip `#8A93A6` | same hues, darker | timeline items |

Focus ring: 2px `--accent` at 60% opacity, 2px offset. Always visible for keyboard users.

### 2.3 Typography

- UI font: **Inter** (fallback: system-ui). Numeric time readouts use `font-variant-numeric: tabular-nums`.
- Mono (timecodes, shortcuts, file paths): **JetBrains Mono** (fallback: ui-monospace).
- Scale: 11 (micro labels), 12 (timeline labels, badges), 13 (editor body), 14 (launcher/settings body), 16 (section titles), 20 (dialog titles), 28 (launcher heading), 56 (countdown numerals).
- Weights: 400 body, 500 labels/buttons, 600 titles. Never 700+ except countdown.

### 2.4 Spacing, radii, elevation

- Spacing scale: 4, 8, 12, 16, 20, 24, 32, 48.
- Radii: 6 (inputs, small buttons), 8 (cards, buttons), 12 (panels, popovers), 16 (dialogs), 999 (pills, HUD, webcam bubble).
- Shadows (dark): popover `0 8px 24px rgba(0,0,0,0.45)`, dialog `0 24px 64px rgba(0,0,0,0.6)`, HUD pill `0 8px 32px rgba(0,0,0,0.5)` + 1px inner border `--border-strong`.
- Glass: recording HUD and countdown overlays use `backdrop-filter: blur(24px)` over 70% `--bg-panel`.

### 2.5 Iconography

Phosphor-style (1.5px stroke, 20px in toolbars, 16px in rows). Every icon-only button has a tooltip (label + shortcut). Canonical icons: Record (filled circle), Stop (filled square), Pause (two bars), Display (monitor), Window (browser-window), Region (dashed rectangle), Mic, Speaker, Camera, Zoom (magnifier-plus), Cursor (arrow), Speed (gauge), Text (T), Arrow, Shape, Blur (droplet-half), Captions (CC), Export (arrow-square-out), Split (scissors), Trim (bracket), Undo/Redo, Settings (gear), Folder, Play/Pause, Skip-to-start/end, Loop, Fit, Layers.

### 2.6 Core components (draw a component sheet artboard first)

- **Buttons:** primary (accent fill), secondary (panel-raised fill + border), ghost (no fill), destructive (record red), record (circular 56px red with white inner ring). Sizes: sm 28px, md 32px, lg 40px. States: default, hover, active, focus, disabled, loading (spinner replaces label).
- **Icon button:** 28×28 / 32×32, radius 6/8, ghost by default, toggled state uses `--accent-soft` + accent icon.
- **Segmented control:** for MP4/GIF/WebM, Display/Window/Region, aspect ratios.
- **Slider:** 4px track, 14px thumb, value shown in a right-aligned mono input (editable). Double-click resets default. Alt-drag = fine control.
- **Number input / stepper:** mono, unit suffix inside (px, %, ms, s, fps).
- **Select / dropdown:** 32px, chevron right; menus 8px radius, 6px item padding, check on selected.
- **Switch:** 36×20, accent when on.
- **Toggle group** (icon pills) for cursor styles, positions (3×3 grid).
- **Color picker:** swatch button → popover with hue/sat area, hex input, alpha, eyedropper, 8 recent swatches, preset palette.
- **Gradient editor:** angle dial + 2–4 stops.
- **Tabs (inspector):** vertical icon rail (48px wide) with labels on hover, or horizontal at wide widths.
- **Card (recent project):** thumbnail 16:9, title, duration badge, modified date, kebab menu.
- **Dialog:** 16 radius, 24 padding, title 20/600, close X top-right, footer right-aligned actions.
- **Popover:** 12 radius, 12 padding, arrow-less, anchored.
- **Toast (bottom-right):** icon + title + optional description + action; success/error/info/progress variants; progress toast has a thin bar.
- **Tooltip:** 12px text, dark, `Label ⌘K`-style shortcut chip.
- **Timeline item:** rounded 6, colored 8% fill + 1px colored border, 3px colored left cap, label inside, resize handles on hover (6px grab zones), selected = 2px accent border + subtle glow.
- **Playhead:** 1px accent line with 10px triangular head; time readout follows.
- **Empty state:** centered icon (48px, `--text-3`), 16/600 title, 13 body, one primary action.
- **Progress:** linear (4px) and ring (20px in buttons).
- **Keyboard chip:** mono 11px, 1px border, radius 4.
- **Permission row:** icon, name, description, status pill (Granted / Denied / Not determined), action button.

---

## 3. Global rules for all screens

- Draw **every screen in dark AND light**. Dark is canonical; light is a second artboard with the same frame.
- Frame sizes: Launcher 720×520. Editor 1440×900 (also draw 1920×1080 for the main editor). Settings 860×620. Overlays are drawn on a 1728×1080 "user's screen" mock with a fake desktop behind (blurred wallpaper + fake app windows) so the overlay reads correctly.
- Window chrome: macOS traffic lights top-left with 12px inset; on Windows draw a custom title bar (36px) with app icon left, min/max/close right. Title bar is draggable region; draw both platform variants for Launcher and Editor.
- Every interactive control has hover, active, focus, disabled states — draw them in the component sheet, not on every screen.
- Every screen lists **States** — draw each as its own artboard variant.
- Text is real, never lorem. Use realistic filenames ("Onboarding flow walkthrough.reelform"), realistic durations (00:42.180), realistic device names ("MacBook Pro Microphone", "Studio Display", "Logi 4K Brio").

---

## 4. Screens (draw in this order)

### S00 — Component sheet
All components in §2.6 in every state, both themes. Include the timeline item variants for each track color, the 3×3 position grid, the HUD pill in all its states.

---

### S01 — Onboarding: Welcome (first launch)
Frame 720×520, centered card, no sidebar.
- App logo (48px), heading "Record something great" (28/600), subtext one line.
- Illustration: a mini preview of a framed recording with a zoom and cursor (this is the product's promise).
- Primary "Get started", ghost "Import existing project".
- Footer: version, "Terms" link.
States: default.

### S02 — Onboarding: Permissions
Same frame. Title "Reelform needs a few permissions".
Permission rows (in order): **Screen Recording** (required), **Microphone**, **Camera**, **Accessibility** (for cursor tracking & click detection; on macOS), **Notifications** (optional).
Each row: status pill + button "Allow…" → opens system dialog; after grant becomes green check "Granted". Row for Screen Recording shows helper text "macOS will ask you to restart Reelform after granting" when applicable.
Primary "Continue" disabled until Screen Recording granted; ghost "Skip for now" for the optionals.
States: nothing granted; partial; all granted; **denied** (row shows "Open System Settings" secondary button + inline explanation).
Windows variant: only Microphone/Camera rows shown (Screen capture needs no prompt), helper text differs.

### S03 — Onboarding: Save location & defaults
Title "Where should recordings go?" — folder picker (path in mono, "Change…"), switch "Auto-delete raw recordings after export (keep project)", default frame rate segmented (30 / 60), "Open editor automatically after recording" switch. Primary "Finish".

### S04 — Launcher (home)
Frame 720×520. Left column 240px, right content.
**Left column:** app name + "New recording" big primary button (full width, record icon), then "Open project…", then list: Recent, All projects, Trash (soft-deleted projects). Bottom: Settings gear, Help, version.
**Right (Recent):** heading "Recent projects", search field, grid of project cards (2 columns). Card kebab: Open, Reveal in Finder/Explorer, Duplicate, Rename, Move to Trash.
States: **empty** (no projects — big illustration + "Record your first video"), populated, search-with-no-results, **update available** banner across the top (accent-soft strip: "Reelform 1.2 is available — Restart to update"), **permission missing** banner (warning: "Screen Recording permission was revoked").
Also draw the **tray / menu-bar menu**: New recording ⌘⇧R, Recent (submenu), Open editor, Pause/Resume (only while recording), Stop recording, Settings, Quit.

### S05 — Recording HUD (pre-record)
Overlay on user's screen mock. A floating glass pill, 560×64, bottom-center of the screen, draggable.
Left→right:
1. **Source segmented control**: Display / Window / Region (icons + labels). Selected state.
2. Divider.
3. **Source chip**: shows currently chosen source ("Studio Display" / "Figma — Onboarding.fig" / "1280×720 region") with a chevron; click opens S06.
4. Divider.
5. **Mic** button (icon + level meter bars, 5 bars animate) with dropdown chevron → device list + "Off".
6. **System audio** toggle button (icon; on = accent).
7. **Camera** toggle with dropdown → device list, "Off", "Show preview".
8. Divider.
9. **Record** button (red circle, 40px, white ring). Tooltip "Start recording ⌘⇧R".
10. Overflow "⋯": Countdown (Off/3/5/10), Cursor: Show/Hide during capture, Frame rate 30/60, Hide HUD while recording, Settings…, Quit.
Above the pill (when Window or Region selected): a thin accent outline around the target on the desktop mock.
States: Display selected; Window selected (outline on a window); Region selected; mic on with live meter; mic off; camera on with **webcam preview bubble** (S09) shown; **fallback warning** chip above pill ("Native capture unavailable — using fallback, cursor may be visible"); **error** (mic device disconnected → chip in warning).

### S06 — Source picker
Popover anchored to the source chip, 720×420, or full-screen picker on Windows/Linux (draw both).
Tabs: Displays | Windows. Grid of live thumbnails (16:9, 200px wide), name below, resolution/refresh micro label. Selected = accent border. Displays tab shows monitor arrangement mini-map at top. Windows tab has search field, groups by app (app icon + name header). Toggle "Exclude Reelform windows" (on by default). Footer: "Cancel", "Select".
States: default; searching; a window minimized (thumbnail dimmed "Minimized"); no windows.

### S07 — Region selector
Full-screen dimmed overlay (`rgba(0,0,0,0.45)`) with a crosshair cursor. Dragging draws a clear rectangle with 8 handles and a size badge "1280 × 720" (mono, glass chip). Preset chips floating above the selection: 16:9, 4:3, 1:1, 9:16, 1920×1080, 1280×720, Custom. Snapping guides (accent hairlines) to window edges. Bottom-center mini pill: "Record this region" primary + "Cancel". Esc cancels.
States: before drag (hint text "Drag to select a region · Esc to cancel"); during drag; after selection (handles + pill); aspect-locked (badge shows lock icon).

### S08 — Countdown
Full-screen transparent; centered glass disc 160px with numeral 56/700 "3", ring progress around it. Beneath: "Press Esc to cancel". HUD pill collapses. Draw 3, 2, 1 and a "Go" frame.

### S09 — Webcam preview bubble (during setup and recording)
Circular (default) 180px, draggable, bottom-left default. Shows camera feed. Hover reveals: mirror toggle, size (S/M/L), shape (circle / rounded-square), hide. During recording it becomes non-interactive except drag. Draw circle + rounded-square variants, mirrored state, and "No camera" state (placeholder icon).

### S10 — Recording control pill (while recording)
The HUD shrinks to 300×48: red pulsing dot + timer `00:42.1` (mono tabular) + audio level mini-meter + **Pause** + **Stop** (primary red square) + overflow (Restart, Discard, Hide pill, Mute mic).
States: recording; paused (dot solid, timer static, "Resume" replaces Pause); muted mic (mic icon struck through, warning tint); **hidden mode** (only a 20px red dot in the corner; tray icon shows a red badge); low disk space warning strip; capture interrupted error (display disconnected) — pill turns warning with "Recording saved up to 00:42".

### S11 — Post-record transition
Small dialog center screen: "Processing recording…" progress (finalizing file, extracting cursor data). If "Open editor automatically" is off: card with thumbnail, duration, buttons "Open in editor" (primary), "Reveal file", "Record another", "Delete".

---

### S12 — Editor (main)
Frame 1440×900 and 1920×1080. Regions:

**A. Top bar (48px):** left — traffic lights / app icon, project name (editable inline, shows "•" when unsaved), breadcrumb "▸ Projects". Center — undo/redo, zoom-to-fit, preview quality select (Auto/Full/Half), "Preview backend: WebGPU" micro label in a tooltip. Right — "Share/Export" primary button (accent), split arrow for "Export as…", and "⌘E". Also: Extensions button (puzzle icon), Shortcuts help "?", Settings gear.

**B. Preview canvas (fills center):** sunken well, the composed frame centered with letterboxing at the chosen aspect ratio. The framed recording shows background/wallpaper, padding, rounded corners, shadow, cursor overlay, webcam bubble, annotations, captions. Overlay controls on hover: zoom-region focus reticle (draggable crosshair box when a zoom region is selected), webcam bubble drag/resize handles, annotation transform handles, crop rectangle (when crop mode on). Top-left of canvas: aspect ratio chip (16:9 ▾). Bottom of canvas: canvas zoom (Fit / 50 / 100%).

**C. Inspector (right, 320px, resizable 280–420):** vertical icon rail + panel. Tabs (in this order): **Frame**, **Cursor**, **Zoom**, **Webcam**, **Audio**, **Captions**, **Annotate**, **Effects**, **Project**. Each drawn in S13–S21.

**D. Playback bar (44px above timeline):** skip-to-start, back 1 frame, play/pause, forward 1 frame, skip-to-end, loop toggle, current time `00:12.340` / total `01:04.000` (mono), then right-aligned: split at playhead (scissors), delete selection, snap toggle (magnet), timeline zoom slider (−/+), "Fit".

**E. Timeline (bottom, 260px default, resizable 180–420):** left track header column (140px) + scrollable track lanes + ruler on top (timecodes, 1s major ticks, frame ticks at high zoom). Tracks top→bottom: **Video** (clip blocks with thumbnails strip and audio waveform mini), **Zoom**, **Speed**, **Annotations**, **Captions**, **Webcam** (enable/disable regions), **Audio** (extra audio regions), **Mic** and **System** waveform lanes (read-only, with mute/solo). Each header: icon, name, eye (hide), lock, "+" (add region at playhead). Playhead spans all lanes. Trimmed-out ranges appear hatched and dimmed. Zoom regions show a mini focus-point icon and the zoom level "1.8×". Speed regions show "2×" / "0.5×".

States to draw (each an artboard):
1. Fresh recording just opened — **auto-zoom suggestions** shown as ghost (dashed, 50% opacity) zoom items with a toast "We suggested 6 zooms · Keep all / Review / Dismiss".
2. Playing (playhead mid-timeline, play button shows pause).
3. Zoom region selected (canvas shows focus reticle, inspector auto-switches to Zoom tab, item has accent border).
4. Trimming (dragging a clip edge — tooltip with new duration, hatched removed area).
5. Split hover (scissors cursor with vertical ghost line).
6. Multi-select (marquee across items, 3 items selected, inspector shows "3 items" summary with Delete / Align).
7. Speed region selected.
8. Annotation selected (transform handles on canvas).
9. Crop mode (canvas dims outside crop; 8 handles; aspect lock; "Done / Reset").
10. Webcam bubble drag on canvas with snap guides + position grid overlay.
11. Export running (top bar button becomes progress ring "Exporting 43%" and a bottom-right progress toast; editor still usable).
12. Unsaved-changes badge and the "Save changes?" dialog (Save / Don't save / Cancel).
13. Missing media state (source file moved — canvas shows "Media offline" with "Locate…" button, timeline clip hatched red).
14. Narrow layout (1024×700) — inspector collapses to icon rail with popover panels; timeline height 180.
15. Light theme of state 1.

---

### S13 — Inspector: Frame
Sections (accordion, all open by default, remember collapse state):
- **Background**: segmented Wallpaper / Color / Gradient / Image / None. Wallpaper: 4-column grid of 24 thumbnails (categories chips: Abstract, Gradient, Mesh, Mac, Solid, Custom), "Add custom…" tile. Color: swatch + picker. Gradient: gradient editor. Image: dropzone + "Fit/Fill" + blur amount.
- **Blur** background slider 0–40 px (applies to wallpaper/image).
- **Padding** slider 0–200 px (+ "Match all sides" toggle; when off shows T/R/B/L steppers).
- **Corner radius** 0–64 px; **Squircle** switch.
- **Shadow**: strength 0–100, offset Y, blur, color.
- **Border**: width 0–8, color, opacity.
- **Aspect ratio**: 16:9, 9:16, 1:1, 4:3, 4:5, 21:9, Source, Custom (W×H).
- **Inset (source scale)**: 50–100% — how big the recording sits inside the frame.
- **Presets** row at top: "Default", "Minimal", "Product Hunt", "Twitter", "Vertical" + "Save current as preset…".
States: wallpaper selected; gradient editing; image dropzone empty/hover/filled; custom aspect editing.

### S14 — Inspector: Cursor
- **Show cursor** switch (master).
- **Style**: toggle group of cursor sets: macOS (default), macOS Dark, Windows, Minimal Dot, Custom (upload PNG/SVG). Preview tile of the arrow, hand, text-beam, resize variants.
- **Size** 50–300 %.
- **Smoothing** 0–100 (label "Snappy ⟷ Silky").
- **Motion blur** switch + amount.
- **Click effect**: None / Ripple / Bounce / Highlight ring; color; size.
- **Sway** (subtle idle drift) switch.
- **Hide when idle** switch + delay (s).
- **Loop mode** switch (cursor returns to start position for seamless GIF loops).
- **Click sound**: None / Soft / Mechanical / Custom; volume.
- Section "Cursor data": pill "Tracked ✓ 1,204 points" or warning "No cursor data — rendered cursor unavailable" with explanation.
States: default; custom cursor upload; no telemetry.

### S15 — Inspector: Zoom
Top: **Auto-zoom** card — "Generate suggestions" primary (or "Regenerate"), sensitivity slider (Fewer ⟷ More), "Follow cursor while zoomed" switch, "Zoom on clicks" switch, "Zoom on typing" switch.
When a **zoom region is selected**: 
- Zoom level 1.0–4.0× (slider + input).
- Focus: 3×3 grid + "Follow cursor" + X/Y numeric; "Set from canvas" hint.
- Ease in / ease out duration (ms) and curve (Ease, Spring, Linear) with a tiny curve preview.
- Timing: start/end (mono, editable), duration.
- "Duplicate", "Delete".
When none selected: helper "Select a zoom on the timeline or add one at the playhead (+)".
Global: **Motion** — "Camera smoothing" slider, "Max zoom speed".
States: no selection; region selected; suggestions pending (spinner "Analyzing cursor activity…"); no telemetry (auto-zoom disabled with explanation).

### S16 — Inspector: Webcam
- **Enabled** switch. Source: "Recorded webcam (00:42)" or "Upload video…" / "Replace" / "Remove".
- **Shape**: Circle / Rounded / Square / Pill.
- **Size** 10–50 % of frame height.
- **Position**: 3×3 grid + custom X/Y + **Margin** slider.
- **Mirror** switch.
- **Border** width/color, **Shadow** strength, **Corner radius** (for rounded).
- **Zoom-reactive** switch ("Shrinks during zooms to keep balance").
- **Crop / reframe** button → S16b modal: shows webcam frame with a circle/rect crop overlay, zoom slider, "Center on face" button, Apply.
- **Sync offset** (ms) stepper with "Auto-sync" button (aligns by audio).
States: no webcam ("Add a webcam video" empty); enabled; crop modal.

### S17 — Inspector: Audio
- **Tracks** list: Microphone, System audio, each with: waveform preview mini, volume slider (−∞…+12 dB), mute, solo, **Noise reduction** switch (mic), **Normalize** switch, **Fade in/out** ms.
- **Extra audio**: list of added audio regions (music/voiceover) with file name, volume, fade, loop switch, "Duck under voice" switch + amount; "Add audio…" button.
- **Master**: output volume, "Mute all".
- **Clicks**: "Cursor click sounds" volume (mirrors S14 setting).
States: only mic; mic + system; extra music added with ducking on; a track missing.

### S18 — Inspector: Captions
- Top: **Generate captions** primary button with language select (Auto-detect / list) and model select (Fast / Balanced / Accurate — sizes shown "75 MB", "466 MB", "1.5 GB"). If model not downloaded: "Download (466 MB)" with progress bar. Info line: "Runs on-device. Nothing leaves your computer."
- **Caption list**: rows with timecode range (mono) + editable text; click seeks; enter splits; backspace at start merges; "Add caption" at playhead; search field.
- **Style**: Preset chips (Clean, Bold, Karaoke, Outline, Pill), font select (+ "Add custom font…"), size, color, background pill color/opacity, position (Bottom/Top/Custom Y), max lines, **word-highlight** switch (karaoke) with highlight color, uppercase switch.
- **Export**: "Burn into video" switch, "Export .srt" / ".vtt" buttons.
States: no captions (empty + generate); generating (progress "Transcribing 34%… 00:14/00:42"); list populated; editing a row; model downloading; error ("Couldn't transcribe — no speech detected").

### S19 — Inspector: Annotate
Toolbar of tools at top: **Text**, **Arrow**, **Line**, **Rectangle**, **Ellipse**, **Highlight** (translucent marker), **Blur/pixelate region**, **Image/logo**, **Emoji**, **Number badge** (auto-increment 1,2,3), **Keystroke badge** (auto from key telemetry: "⌘K").
Selecting a tool → click/drag on canvas creates it at playhead with default 3s duration (an Annotations track item).
When an annotation is selected: type-specific props — Text: content (multiline), font, size, weight, color, background pill, padding, align; Arrow/Line: stroke width, color, head style, dashed; Shapes: fill/stroke/opacity/radius; Blur: strength, pixelate switch; Image: opacity, fit, corner radius; all: **Animation in/out** (None, Fade, Pop, Slide from ▸) + duration; position X/Y/W/H/rotation; **Follow zoom** switch (annotation moves with the camera) ; Duplicate / Delete; timing.
States: no selection (tool palette + tips); text selected; blur selected; keystroke badge auto-generated list ("Detected 14 shortcuts · Add all").

### S20 — Inspector: Effects
- **Speed**: for a selected speed region: speed 0.25–8×, "Keep pitch" switch, ramp in/out (ms). Global: "Remove silence" tool → dialog with threshold slider, min silence length, preview count "Would remove 12 gaps (00:18 total)"; "Auto speed-up idle" tool (speed up sections with no cursor movement).
- **Transitions** between clips (after split): None / Cross-dissolve / Cut-with-zoom; duration.
- **Intro / Outro**: Add title card (text, bg, duration) at start / end.
- **Color**: brightness, contrast, saturation, "Grain" switch (subtle), vignette.
- **Motion**: "Subtle 3D tilt on zooms" switch, "Parallax background" switch.
States: speed region selected; remove-silence dialog; intro card added.

### S21 — Inspector: Project
- Name, location (mono path, "Reveal"), created/modified, source file(s) with size, "Relink media…".
- **Recording info**: resolution, fps, duration, capture backend used ("ScreenCaptureKit"), cursor data points, audio tracks.
- **Save raw with project** switch, "Trim source to used range (saves 1.2 GB)" button.
- Danger zone: "Delete project".

---

### S22 — Export dialog
Modal 640×560 (or side sheet 400px — draw the modal).
Left: live preview thumbnail with output dimension overlay "1920 × 1080 · 60 fps · ~24 MB est.".
Right controls:
- **Format** segmented: MP4 · GIF · WebM.
- MP4/WebM: **Resolution** (Source, 4K, 1440p, 1080p, 720p, Custom), **Frame rate** (Source / 60 / 30 / 24), **Quality** (Draft / Good / High / Max — shows bitrate), **Codec** (H.264 / HEVC / AV1 where available; disabled options greyed with "Not supported on this device"), **Audio** (AAC 192k / Mute), **Hardware acceleration** switch (auto).
- GIF: **Size** (Small 480p / Medium 720p / Large 1080p / Custom), **FPS** (10/15/20/30), **Loop** switch, **Dither** (None/Bayer/Floyd), **Colors** 32–256, estimated size.
- **Range**: Entire project / Selection / In–Out.
- **Captions**: Burn in / Sidecar .srt / None.
- **Filename** input, **Destination** folder, "Reveal after export" switch, "Copy to clipboard after export" switch.
- Footer: "Cancel" ghost, **"Export"** primary (with estimate).
States: MP4 default; GIF; WebM; **exporting** (dialog collapses into progress panel: bar, phase label "Rendering frames 2,140 / 3,840", ETA, speed "2.3× realtime", "Cancel"); **done** (checkmark, file card with size, buttons "Reveal", "Copy", "Share…", "Export another"); **failed** (error text, "Retry with software encoder", "Copy diagnostics"); **low disk**; **codec unsupported** fallback notice.

### S23 — Project browser dialog (⌘O)
Modal 900×600: sidebar (Recent / All / Trash / folders), grid or list toggle, sort, search; project row: thumbnail, name, duration, modified, size, kebab. Footer "Open".
States: grid; list; trash (restore / delete forever); empty.

### S24 — Settings window
860×620, left nav 200px: **General**, **Recording**, **Editor**, **Shortcuts**, **Appearance**, **Updates**, **Extensions**, **Advanced**, **About**.
- General: language select, save folder, "Open editor after recording", "Launch at login", "Show in menu bar/tray", "Send anonymous usage stats" (off default) with privacy link, "Check for updates automatically".
- Recording: default source, frame rate 30/60, default mic/camera/system audio, countdown default, "Hide HUD while recording", "Hide desktop icons", "Do Not Disturb while recording", "Show clicks during capture", auto-delete raw after export, max recording length, disk space warning threshold.
- Editor: default frame preset, default aspect, autosave interval, preview quality, auto-zoom on new recording (switch + sensitivity), snap by default, undo history size.
- Shortcuts: table (Action | Shortcut | Reset) grouped: Global (Start/stop, pause, region record), Editor (play, split, trim, zoom in/out, nudge ±1 frame, delete, save, export…), Timeline. Click a shortcut → record new keys inline; conflict warning inline.
- Appearance: Theme (System/Dark/Light), accent color choice (6 swatches), UI density (Comfortable/Compact), reduce motion.
- Updates: current version, channel (Stable/Beta), "Check now", release notes accordion, "Restart to update" when downloaded.
- Extensions: installed list (icon, name, version, enabled switch, permissions chips, "Open folder", remove), "Browse marketplace" and "Install from file…".
- Advanced: capture backend override (Auto / Native / Fallback), GPU export (Auto/On/Off), hardware encoder list with status, log level, "Open logs folder", "Reset all settings", cache size + "Clear cache".
- About: logo, version, credits, licenses, "Copy diagnostics".
States: each page default; shortcut recording inline; conflict; update downloaded; extension with permission prompt.

### S25 — Keyboard shortcuts overlay (?)
Full-window glass sheet listing shortcuts in 3 columns grouped, search field, "Customize…" link.

### S26 — Extension permission prompt
Dialog: extension icon/name/author, "wants to:" list of permission rows (Render into video, Read timeline, Add settings panel, Play sounds, Access files), "Allow" / "Deny".

### S27 — Dialogs & system states
Draw each: Save changes? · Delete project? (with "Also delete recording files" checkbox) · Discard recording? · Relink media (file picker prompt with old path) · Update ready (release notes + Restart now / Later) · Crash recovered ("We restored your last session") · Low disk space · Permission revoked · Screen capture blocked by another app · "Recording too short" (<1s).

### S28 — Toasts sheet
Success: "Exported · Onboarding.mp4 (24 MB) — Reveal · Copy". Progress: "Exporting 43% · 1:12 left — Cancel". Info: "6 zooms suggested — Review". Warning: "Mic disconnected, continuing without mic". Error: "Export failed — Retry · Details". Autosaved (tiny, 1.5s).

### S29 — Marketing/website hero (optional, one artboard)
1440×900 landing hero using the product frame: headline, subhead, download buttons (macOS / Windows / Linux), a big framed demo GIF placeholder, 3 feature tiles (Auto-zoom, Cursor, Captions).

---

## 5. Interaction specs the visuals must reflect

- **Selection model:** click selects one item; shift-click extends; ⌘/Ctrl-click toggles; drag on empty timeline = marquee; Esc clears. Selected items get accent border; canvas shows their handles.
- **Timeline gestures:** drag item = move (snaps to playhead, other item edges, 1s grid when snap on); drag edge = resize; alt-drag = duplicate; ⌘/Ctrl-scroll = zoom timeline around cursor; shift-scroll = horizontal pan; double-click ruler = set playhead; S = split at playhead; [ ] = trim start/end to playhead; Delete removes; ⌘Z/⇧⌘Z undo/redo (history shows in tooltip "Undo: Move zoom").
- **Canvas gestures:** drag zoom-reticle to set focus; scroll on canvas = zoom canvas (not project); space = play/pause; ← → frame step; shift+← → 1s step; J K L shuttle.
- **Playback:** playhead readout updates every frame; timeline auto-scrolls to keep playhead visible when playing (page-flip, not smooth pan).
- **Auto-save** every 30s and on blur; "•" indicator; autosaved toast only on manual ⌘S.
- **Drag & drop** onto canvas/timeline: video → new clip or webcam (asks), audio → extra audio region, image → annotation, `.reelform` → open project, `.srt` → captions.
- **Responsiveness:** min editor 1024×700; inspector collapses to icon rail; timeline can be collapsed to 48px header strip.
- **Accessibility:** all controls keyboard reachable; sliders arrow-adjustable; visible focus; contrast ≥ 4.5:1 for text; reduce-motion respected; timeline items have text labels not just color.

---

## 6. Deliverables checklist for Claude Design

- [ ] S00 component sheet (dark + light)
- [ ] S01–S03 onboarding (incl. denied states, Windows variant)
- [ ] S04 launcher (5 states) + tray menu
- [ ] S05 HUD (7 states) · S06 source picker (2 layouts) · S07 region (4 states) · S08 countdown · S09 webcam bubble · S10 recording pill (6 states) · S11 post-record
- [ ] S12 editor (15 states at 1440×900, main state also at 1920×1080)
- [ ] S13–S21 inspector tabs (each with listed states)
- [ ] S22 export (8 states) · S23 project browser · S24 settings (9 pages) · S25 shortcuts · S26 extension prompt · S27 dialogs · S28 toasts · S29 hero
- [ ] Both platform title-bar variants for Launcher and Editor
- [ ] A "design tokens" artboard listing every token from §2.2–2.4

Naming convention for artboards: `S12-Editor / 03 Zoom selected / Dark`.
