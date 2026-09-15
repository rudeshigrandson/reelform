# Architecture

Reelform is an Electron app with three kinds of processes: the **main**
process, sandboxed **renderer** windows, and stand-alone **native helper**
executables. The source of truth for behaviour is
`.claude/refrence/03_ENGINEERING_SPEC.md`; this page is the map.

## Processes

```
┌───────────────────────────────────────────────────────────────┐
│ Electron main (electron/)                                     │
│  window/lifecycle, single-instance lock, permissions          │
│  filesystem, project store, settings, updater, tray           │
│  capture backends + native helper processes                   │
│  ffmpeg (mux / transcode fallback), whisper-cli (captions)    │
└───────────────┬───────────────────────────────────────────────┘
                │ typed IPC (electron/ipc/contracts.ts, zod-validated)
┌───────────────┴───────────────────────────────────────────────┐
│ Renderer windows (src/) — React + PixiJS                      │
│  launcher · editor · settings · HUD · overlays                │
│  GPU compositing and preview (PixiJS)                         │
│  WebCodecs encode (primary export path)                       │
└───────────────┬───────────────────────────────────────────────┘
                │ line-delimited JSON over stdio
┌───────────────┴───────────────────────────────────────────────┐
│ Native helpers (electron/native/)                             │
│  macOS: ScreenCaptureKit recorder, cursor monitor (Swift)     │
│  Windows: Windows.Graphics.Capture recorder, cursor (C++)     │
└───────────────────────────────────────────────────────────────┘
```

- **Main** owns everything with side effects: capture lifecycle, helper
  processes, file I/O, project files, settings, global shortcuts, updater, tray,
  permissions, the `reelform-media://` range-request protocol, the captions
  runtime and export finalization.
- **Renderers** run with `contextIsolation`, `sandbox` and no Node integration.
  The preload (`electron/preload.ts`) exposes one typed object,
  `window.reelform`, with `invoke(channel, payload)` and `on(channel, cb)`.
- **Helpers** produce files and telemetry, then exit. They contain no business
  logic the editor depends on, and they are hash-verified (`manifest.json`)
  before they're spawned.

## Windows

| Window | Code | Notes |
|---|---|---|
| Launcher | `src/launcher/` | Project browser, record entry, onboarding gate |
| Editor | `src/editor/` | One per project |
| Settings | `src/settings/` (pages), `src/app/settings/` (IPC wiring) | Single instance |
| HUD | `src/hud/` | Transparent, always on top, excluded from capture |
| Overlays | `src/overlays/` | Region selector, countdown, webcam bubble |

`src/router/` picks the window from `?window=…`. `src/app/windows/` mounts the
shared providers (settings, shortcuts, i18n) per window.

## IPC

All channels, request and response schemas live in `electron/ipc/contracts.ts`.
It merges the per-domain contract files (`electron/<domain>/contracts.ts`:
settings, recording, captions, permissions, diagnostics, export, project,
updater, …). The renderer imports types through the `@contracts` alias and
never imports other `electron/` code. Main validates every request with zod
at the boundary. Errors cross IPC as stable codes (`ReelformIpcError`), so the
UI picks the copy.

Events (main → renderer) are declared the same way, for example
`settings:changed`, `shortcuts:globalStatusChanged` and `updater:changed`.

## Pipelines

- **Capture:** `electron/capture/` selects a backend: the native helper, or
  Chromium `desktopCapturer` as the cross-platform fallback. The recording
  controller (`electron/recording/`) writes crash-safe media plus a telemetry
  file (cursor path, clicks, key codes) and finalizes a project.
- **Edit:** the editor state is Zustand + immer with a command/history layer.
  The PixiJS scene graph renders the frame, background, camera zoom, cursor,
  webcam, captions and annotations. `src/editor/autozoom/` is a pure,
  unit-tested suggestion engine fed by telemetry.
- **Export:** `src/export/` renders frames through the same scene, encodes with
  WebCodecs (`VideoEncoder`/`AudioEncoder`) and muxes with mediabunny. GIF
  has its own worker encoder. `electron/export/` and `electron/media/` use
  ffmpeg only for fallback routes and finalize steps.
- **Captions:** `electron/captions/` extracts timeline audio, splits it into
  chunks, runs `whisper-cli` on-device, and returns word-timed segments.
  Models download on demand into `userData/models` with sha256 verification.

## Data

- Projects are folders (`.reelform` package on macOS) holding versioned,
  forward-migratable JSON plus relative media. No cloud sync in 1.0.
- Settings: `userData/settings.json`, schema and migrations in
  `electron/settings/`, mirrored to every window via `settings:get/set/changed`.
- Logs and diagnostics: `electron/diagnostics/`. Paths and the user name are
  scrubbed before anything is copied.

## Design system and strings

- `src/design/tokens.css` defines the semantic tokens for the light and dark
  themes, density (`data-density`) and reduced motion (`data-reduce-motion`
  plus `prefers-reduced-motion`). Components use tokens, never raw colors.
- `src/i18n/` has a typed `t(key, vars)` with an ICU subset (interpolation and
  plurals) and `locales/en.json`. `electron/i18n.ts` reads the same catalog for
  main-process strings.

## Packaging

`electron-builder.json5` builds a universal dmg/zip (macOS), NSIS (Windows)
and an AppImage (Linux). Helpers, whisper-cli, ffmpeg, tray icons and the
license files ship as `extraResources`. `scripts/after-pack.cjs` signs the
helpers and re-hashes their manifests. See [RELEASING.md](RELEASING.md).

## Reference architecture

OpenScreen (MIT, https://github.com/siddharthvaddem/openscreen) and Cap
inform the cross-platform capture and native-helper approach. No OpenScreen
code is included; see `NOTICE.md`. Recorded decisions live in [ADRs/](ADRs/).
