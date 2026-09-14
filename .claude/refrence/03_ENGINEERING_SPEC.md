# Reelform — Engineering Specification (v1.0)

Audience: the engineering team building Reelform from zero to a shippable 1.0. This is the source of truth for architecture, module boundaries, data contracts, per-feature behaviour, quality bars and release mechanics. UI visuals live in `01_CLAUDE_DESIGN_UI_GUIDE.md`; scope/timeline in `02_PLAN.md`. When this doc and the code disagree, fix one of them the same day.

Conventions: **MUST / SHOULD / MAY** as in RFC 2119. "Main" = Electron main process. "Renderer" = the editor/launcher web contexts. "Helper" = a native child-process binary.

---

## 0. Stack (pinned)

| Layer | Choice | Notes |
|---|---|---|
| Shell | Electron ≥ 33 (Chromium ≥ 130) | Needs WebCodecs, WebGPU, `desktopCapturer`, `MediaRecorder` VP9/H.264 |
| Language | TypeScript 5.x strict, ESM | `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` on |
| Build | Vite 5 + `vite-plugin-electron`, `electron-builder` 26 | Main bundled to CJS (`dist-electron/main.cjs`), preload to CJS, renderer ESM |
| UI | React 18, Tailwind 3, Radix primitives, `motion`, Phosphor icons, `sonner`, `react-resizable-panels` | Components generated from the design guide; no other UI kit |
| State | Zustand + immer; command/history layer (see §7) | One store per domain: `project`, `timeline`, `playback`, `ui`, `export`, `settings` |
| Preview | PixiJS 8 (WebGPU → WebGL2), `pixi-filters` | One `Application` per editor window; offscreen for export |
| Media | WebCodecs (`VideoDecoder`/`VideoEncoder`/`AudioEncoder`), `mediabunny` (mux/demux MP4/WebM), `mp4box` (fallback parse), `gif.js` → replaced by our own worker-based GIF encoder (§10.6) | ffmpeg-static + ffprobe-static bundled (asarUnpack) for fallbacks/transcodes |
| Native | Swift (SCK helper, cursor monitor, system cursor assets) · C++/WinRT (WGC helper, cursor monitor, HW probe) · `uiohook-napi` (global input hook; Win/Linux) | Helpers are stand-alone executables speaking a line-delimited JSON protocol over stdio (§5.5) |
| Captions | whisper.cpp built in CI (Metal on mac, CUDA/Vulkan optional on win/linux, CPU always) | Models downloaded on demand to `userData/models` |
| Lint/test | Biome; Vitest + fast-check; Playwright (Electron) for e2e; golden-frame image tests | CI must be green to merge |
| CI/CD | GitHub Actions matrix (macos-14 arm64 + macos-13 x64, windows-latest, ubuntu-22.04); signing/notarization in CI; GitHub Releases + `electron-updater` | Beta & Stable channels |
| Crash/telemetry | Sentry (Electron SDK) opt-in; PostHog opt-in, off by default | No PII, no file paths, no frames |

Minimum OS: macOS 14 (SCK audio), Windows 10 19041, Linux glibc ≥ 2.31 with PipeWire for system audio.

---

## 1. Repository layout

```
reelform/
  package.json  biome.json  vite.config.ts  electron-builder.json5  tsconfig*.json
  electron/                      # main process
    main.ts                      # app lifecycle, single-instance lock, protocol handlers
    preload.ts                   # contextBridge → window.reelform (typed)
    windows/                     # BrowserWindow factories: launcher, editor, settings, hud, overlays
    ipc/                         # one file per domain; handlers registered via registerIpc()
      contracts.ts               # ALL channel names + request/response types (shared with renderer)
      recording/  sources/  telemetry/  project/  export/  captions/  settings/  updater/  permissions/  extensions/
    capture/                     # capture backend abstraction + per-OS implementations
      backend.ts  electronBackend.ts  sckBackend.ts  wgcBackend.ts  helperProcess.ts
    media/                       # ffmpeg/ffprobe wrappers, media server (range-request file serving)
    native/                      # source for helpers (never JS)
      mac/  ScreenCaptureKitRecorder.swift  CursorMonitor.swift  SystemCursorAssets.swift  WindowList.swift
      win/  wgc-capture/  cursor-monitor/  hw-probe/   (CMake)
      linux/ pipewire-audio/ (1.1)
      bin/<platform-arch>/       # prebuilt outputs committed via CI artifacts, manifest.json with sha256
    updater.ts  appPaths.ts  settingsStore.ts  logger.ts  diagnostics.ts
  src/                           # renderer
    main.tsx  App.tsx  router.tsx
    design/                      # tokens.css, theme.ts, components/ui/* (from design guide)
    launcher/  onboarding/  hud/  overlays/ (region, countdown, webcam bubble)  settings/
    editor/
      EditorWindow.tsx
      preview/                   # Pixi scene graph, layers, camera, cursor renderer, filters
      timeline/                  # ruler, tracks, items, dnd, snapping, marquee
      inspector/                 # one folder per tab
      state/                     # zustand stores, commands, history, selectors
      model/                     # project schema types, migrations, validation (zod)
      autozoom/                  # suggestion engine (pure, tested)
      audio/                     # graph builder, processors (NR, normalize, ducking)
      captions/                  # list model, style, layout
      annotations/               # types, renderers, keystroke detection
    export/                      # exporter engine (renderer side), routes, encoders, muxers, workers/
    shared/                      # utils, geometry, easing, time math, ids
    i18n/  locales/en.json
  scripts/                       # build-native-helpers, build-whisper, sign, notarize, checksums, smoke
  tests/  e2e/  golden/  fixtures/ (short recordings + telemetry + expected frames)
  docs/  ARCHITECTURE.md  CONTRIBUTING.md  RELEASING.md  ADRs/
```

Rules: renderer never imports from `electron/`; both import types from `electron/ipc/contracts.ts` via a path alias `@contracts`. Native helper source never contains business logic that the editor depends on — helpers produce files + telemetry and exit.

---

## 2. Process & window model

- **Main**: one instance (single-instance lock; second launch focuses and forwards file args). Owns: capture lifecycle, helper processes, file I/O, project files, settings, updater, global shortcuts, tray, permissions, media server, captions runtime, export finalization (file moves, reveal), extension install/validation.
- **Renderer windows** (all `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, CSP `default-src 'self' reelform-media:`):
  - `launcher` 720×520 (resizable min 640×480).
  - `editor` 1440×900 default, min 1024×700, one per project (multiple projects = multiple windows).
  - `settings` 860×620 single instance.
  - `hud` transparent, frameless, always-on-top, `visibleOnAllWorkspaces`, excluded from capture (`setContentProtection(true)` on mac/win; on mac also `NSWindowSharingNone`), 560×64 with room for the warning chip.
  - `region-overlay` one per display, fullscreen transparent, ignores mouse except during selection.
  - `countdown` transparent center overlay.
  - `webcam-bubble` transparent, always-on-top, draggable, content-protected (so it does not appear in the capture — webcam is a separate track composed later).
- **Preload** exposes `window.reelform` — a typed object built from `contracts.ts`: `invoke(channel, payload)` and `on(channel, cb)`. No raw `ipcRenderer` exposure.
- **Media serving**: custom privileged protocol `reelform-media://` (registered as `stream: true`, `supportFetchAPI: true`, bypasses CSP) serving project media with HTTP range support so `<video>` and `fetch` (WebCodecs demux) can seek. Only paths inside registered project/recording roots are servable (allow-list).
- **Workers**: export runs in the editor renderer in a dedicated `Worker` pool (decode worker, render happens on main renderer thread with an `OffscreenCanvas` transferred to a worker where supported; encode worker; GIF quantize worker). Captions/whisper is a main-process child process.

---

## 3. IPC contract (excerpt — full list lives in `contracts.ts`)

All channels are `domain:verb`. Every request/response is a zod-validated object. Errors are `{ code, message, details? }` with stable `code` strings (used by the UI to pick copy).

```ts
// recording
'recording:listSources'   → { displays: DisplayInfo[], windows: WindowInfo[] }   // thumbnails as data URLs, refreshed every 2s while picker open
'recording:start'         { source, region?, audio:{mic?:DeviceId, system:boolean}, webcam?:DeviceId, fps:30|60, countdown:0|3|5|10, hideCursor:boolean } → { sessionId }
'recording:pause' | 'recording:resume' | 'recording:stop' | 'recording:discard'
'recording:event'         (main→renderer) { sessionId, type:'started'|'paused'|'resumed'|'stopped'|'interrupted'|'diskLow'|'deviceLost', ... }
'recording:finalize'      { sessionId } → { recordingId, video: MediaRef, mic?: MediaRef, system?: MediaRef, webcam?: MediaRef, telemetry: TelemetryRef, meta: RecordingMeta }
// project
'project:create' | 'project:open' | 'project:save' | 'project:saveAs' | 'project:list' | 'project:trash' | 'project:restore' | 'project:relink'
// export
'export:begin'            { projectId, config: ExportConfig } → { exportId, tempPath }
'export:writeChunk'       { exportId, chunk: ArrayBuffer }  // streamed from renderer muxer to disk
'export:finish'           { exportId, finalName } → { path }
'export:cancel'           { exportId }
'export:native'           { projectId, plan: NativeRoutePlan } → progress events   // ffmpeg fast path
'export:probeEncoders'    → { h264:HwStatus, hevc:HwStatus, av1:HwStatus, vp9:HwStatus }
// captions
'captions:models'         → ModelInfo[]  |  'captions:download' {model} → progress  |  'captions:transcribe' {audio: MediaRef, model, language?} → progress + { segments }
// telemetry
'telemetry:read'          { ref } → TelemetryFile
// settings / shortcuts / permissions / updater / extensions / system (reveal, openExternal, pickFolder, clipboardWriteFile)
```

---

## 4. Data model — `.reelform` project file (schema v1)

A project is a **directory** with the `.reelform` extension (macOS package; on Windows/Linux a folder opened via the app). Rationale: media lives beside the JSON; moving the folder moves everything.

```
My Demo.reelform/
  project.json          # the document (below)
  media/                # recorded or imported sources (never modified in place)
    screen.mp4  mic.m4a  system.m4a  webcam.mp4  telemetry.json.gz
  cache/                # regenerable: thumbnails, waveforms, proxies, autozoom cache
  exports/              # default export destination (user-changeable)
  thumbnail.jpg
```

`project.json` (zod schema in `src/editor/model/schema.ts`; every write bumps `modifiedAt`; `schemaVersion` migrations in `migrations/`):

```ts
interface Project {
  schemaVersion: 1;
  id: string; name: string; createdAt: string; modifiedAt: string; appVersion: string;
  sources: {
    video: MediaSource;            // { path (relative), durationMs, width, height, fps, codec, hasAudio, colorSpace }
    mic?: MediaSource; system?: MediaSource; webcam?: MediaSource;
    telemetry?: { path; pointCount; hasClicks; hasKeys; sampleHz };
    capture: { backend:'sck'|'wgc'|'dxgi'|'electron'; os; display?; window?; region?; scaleFactor; recordedFps };
  };
  timeline: {
    durationMs: number;                       // derived from clips; stored for fast open
    clips: Clip[];                            // { id, sourceStartMs, sourceEndMs, timelineStartMs } contiguous, ordered
    zooms: ZoomRegion[];                      // { id, startMs, endMs, level, focus:{mode:'fixed'|'follow', x, y}, easeInMs, easeOutMs, curve, source:'auto'|'manual' }
    speeds: SpeedRegion[];                    // { id, startMs, endMs, rate, keepPitch, rampMs }
    annotations: Annotation[];                // discriminated union by kind (§9.7)
    captions: Caption[];                      // { id, startMs, endMs, text, words?: {t0,t1,text}[] }
    webcamRegions: Range[];                   // when the bubble is visible (default: whole)
    audioRegions: AudioRegion[];              // extra audio: { id, path, startMs, endMs, offsetMs, volume, fadeIn, fadeOut, loop, duck:{enabled, amount} }
    transitions: Transition[];                // at clip boundaries
    intro?: TitleCard; outro?: TitleCard;
  };
  frame: FrameSettings;        // background, blur, padding, radius, squircle, shadow, border, aspect, inset, crop
  cursor: CursorSettings;      // style, size, smoothing, motionBlur, clickEffect, sway, hideIdle, loop, clickSound
  webcam: WebcamSettings;      // enabled, shape, size, position, margin, mirror, border, shadow, zoomReactive, crop, syncOffsetMs
  audio: AudioSettings;        // per track: volume, mute, solo, noiseReduction, normalize, fades; master
  captionsStyle: CaptionStyle;
  effects: EffectsSettings;    // color, vignette, grain, tilt3d, parallax
  camera: { smoothing: number; maxZoomSpeed: number };
  exportPresets: ExportConfig[]; lastExport?: ExportConfig;
  ui: { inspectorTab; timelineZoom; timelineHeight; collapsed: Record<string,boolean> };   // non-semantic, may be dropped
}
```

Timeline time is **timeline milliseconds** (after trims/speeds). Every region stores timeline time; a pure function `timelineToSource(tMs)` and inverse map through clips + speed regions. Frame-accurate operations use `fps` from the source and round to frame boundaries.

**Save semantics:** atomic (write `project.json.tmp` → fsync → rename). Autosave every 30s when dirty and on window blur; manual save clears dirty. Backups: last 5 autosaves in `cache/backups/`. Crash recovery: on launch, if a project has an autosave newer than its `project.json`, offer restore.

**Telemetry file** (`telemetry.json.gz`): `{ version:1, sampleHz, origin:'display'|'window'|'region', bounds, scaleFactor, points:[ [tMs, x, y, cursorType] ... ], clicks:[ [tMs, x, y, button, 'down'|'up'] ], keys:[ [tMs, keyCode, modifiers] ], scrolls:[ [tMs, dx, dy] ] }` — coordinates normalized 0..1 relative to the captured area. `tMs` is relative to the **first video frame's presentation timestamp**, not process start (§5.4).

---

## 5. Recording subsystem

### 5.1 Backend abstraction

```ts
interface CaptureBackend {
  id: 'sck'|'wgc'|'dxgi'|'electron';
  isAvailable(): Promise<{ ok: boolean; reason?: string }>;
  listSources(): Promise<Sources>;
  start(opts: StartOptions, sink: EventSink): Promise<Session>;   // Session has pause/resume/stop/discard
}
```
Selection order: user override (Advanced settings) → native for OS if available → `electron`. The chosen backend is recorded in the project (`sources.capture.backend`) and shown in the Project tab.

### 5.2 Electron backend (all OSes; Linux primary)
- `desktopCapturer.getSources` for thumbnails; `getUserMedia` with `chromeMediaSource:'desktop'` constraints; target 60fps, resolution = source pixel size (respect `scaleFactor`).
- Region: capture the whole display, crop in post via `frame.crop` initial value (no re-encode at record time). Store region in telemetry origin so cursor coordinates map correctly.
- Video via `MediaRecorder` (`video/webm;codecs=vp9` preferred, `h264` if available) at bitrate table: 1080p 18 Mbps, 1440p 28, 4K 45, ×1.7 at 60fps; timeslice 250ms; chunks appended to disk via `recording:writeChunk` (never buffered wholly in memory). On stop, fix WebM duration (`@fix-webm-duration/fix`) then **remux** to MP4 with ffmpeg (`-c copy` when H.264, else transcode VP9→H.264 in the background with a progress toast; editor can open the WebM immediately).
- Mic: separate `MediaRecorder` (opus/webm) → remux to m4a (AAC) post-stop. System audio: on Windows/Linux via `getUserMedia` loopback (`chromeMediaSourceId` audio) when the OS supports it; on Linux requires PipeWire; on macOS the Electron backend has **no** system audio (UI shows the limitation).
- Webcam: separate `MediaRecorder` 1280×720@30 8 Mbps (user may choose 1080p) → `webcam.mp4`.
- Cursor hiding: not possible on this backend → UI warns; rendered cursor is still drawn on top (double-cursor risk explained in the warning; cursor telemetry still recorded).

### 5.3 macOS native backend (Swift helper `reelform-sck`)
- ScreenCaptureKit `SCStream` with `SCContentFilter` for display / window / display-with-excluded-windows (exclude Reelform HUD/bubble windows by PID). `SCStreamConfiguration`: pixel format `BGRA` (or `420v` when encoding directly), `showsCursor=false`, `capturesAudio=true` (system), `excludesCurrentProcessAudio=true`, `minimumFrameInterval = 1/fps`, `queueDepth = 8`, `scalesToFit=false`, `width/height` = source pixel size, `sourceRect` for region capture (region handled natively here).
- Encode with `AVAssetWriter` (H.264 HW, `AVVideoProfileLevelH264HighAutoLevel`, bitrate table above, `expectsMediaDataInRealTime=true`, keyframe every 2s) → `screen.mp4`. System audio → `system.m4a` (AAC 192k) via a second writer; mic via `AVCaptureSession` → `mic.m4a`. All three writers share the same `CMClock` (host time) and the helper writes `startHostTimeNs` so offsets are exact.
- Pause: stop appending but keep session; on resume, subtract paused duration from PTS so the file is continuous. Track paused ranges in the meta.
- Protocol (§5.5): `start`, `pause`, `resume`, `stop`, `discard`; emits `ready`, `started {firstFramePtsNs}`, `stats {fps, droppedFrames, fileBytes}` every 1s, `interrupted {reason}`, `stopped {durationMs, paths}`.
- Permissions: `CGPreflightScreenCaptureAccess`/`CGRequestScreenCaptureAccess`; microphone via `AVCaptureDevice.requestAccess`. Helper is a separate signed binary with `com.apple.security.device.audio-input` and camera entitlements inherited from the app bundle; it runs outside the app sandbox (we do not ship on MAS in 1.0).
- Cursor: separate helper `reelform-cursor-monitor` (Swift) sampling `NSEvent.mouseLocation` + `CGEvent` taps at 120Hz for position, clicks (via `CGEventTap` listen-only; requires Accessibility permission — if denied, fall back to `NSEvent.addGlobalMonitorForEvents` which gives clicks but not keys), and key events (only key codes + modifiers, never characters, and only while recording). `SystemCursorAssets` helper extracts current cursor images (arrow, I-beam, pointing hand, resize variants) as PNG @2x for the "macOS" cursor style, once per app version.
- OS cursor hidden by `showsCursor=false`; no CGDisplayHideCursor hacks.

### 5.4 Windows native backend (C++ helper `reelform-wgc.exe`)
- `Windows.Graphics.Capture` (`GraphicsCaptureItem` from monitor/HWND), `IsCursorCaptureEnabled=false` (build ≥ 20348 for windows; monitors on 19041), `IsBorderRequired=false` where available; frame pool `DirectXPixelFormat::B8G8R8A8UIntNormalized`, 2 buffers.
- Region: capture monitor, crop on GPU via `ID3D11DeviceContext::CopySubresourceRegion` before encode.
- Encode with Media Foundation `IMFSinkWriter` H.264 (hardware MFT preferred: NVENC/AMF/QuickSync via `MFT_ENUM_FLAG_HARDWARE`; software fallback) → `screen.mp4`; PTS from `QueryPerformanceCounter` frame time relative to first frame.
- System audio: WASAPI loopback (`AUDCLNT_STREAMFLAGS_LOOPBACK`) → AAC via MF → `system.m4a`; mic via WASAPI capture. Same QPC clock; `startQpc` written to meta.
- DXGI Desktop Duplication fallback (`reelform-dxgi`) for builds < 19041 (cursor cannot be hidden → warning).
- Cursor/keys: `reelform-cursor-monitor.exe` using raw input (`WM_INPUT`) + `GetCursorPos` at 120Hz + low-level hooks for clicks/keys (key codes only, only while recording). `uiohook-napi` in main is the fallback and the Linux implementation.
- HW probe helper `reelform-hw-probe.exe` enumerates MF encoders and D3D adapters once per launch; result cached and shown in Advanced settings and used by `export:probeEncoders`.

### 5.5 Helper protocol
Stdio, UTF-8, one JSON object per line. Renderer never talks to helpers; main owns them (`helperProcess.ts`: spawn with `windowsHide`, watchdog, 12s start timeout, kill tree on exit, log stderr to diagnostics ring buffer). Messages carry `{ "t": "<type>", "id"?: number, ...payload }`. Every helper supports `{"t":"ping"}` → `{"t":"pong","version":"1.0.0","caps":[...]}`. Binaries are verified against `bin/<platform>/manifest.json` sha256 at startup; mismatch → backend unavailable with reason.

### 5.6 Session lifecycle (main)
`idle → preparing (permissions, helper ping, disk check ≥ 2GB) → countdown → recording ⇄ paused → finalizing (close writers, remux, gzip telemetry, generate thumbnail/waveforms) → done | discarded | interrupted`.
- Global shortcuts (default ⌘⇧R / Ctrl+Shift+R start-stop, ⌘⇧P pause, Esc cancel countdown) registered only while HUD is open or recording.
- Interruptions (display disconnect, helper crash, disk < 500MB): stop cleanly, keep everything written, mark `interrupted`, open post-record dialog with explanation. Never lose a recording that reached disk.
- Max length default 3h (setting). Files are rotated? No — single file; helpers write fragmented MP4 (`movie fragment` interval 2s) so a crash leaves a playable file; finalize rewrites moov.
- Auto-recordings older than N days that were never opened are pruned (setting, default 14 days, only if not attached to a project).
- Telemetry alignment: helper reports `firstFramePtsNs` (host clock). Cursor monitor timestamps in the same host clock. Main rebases telemetry `tMs = (hostNs - firstFramePtsNs)/1e6`. For the Electron backend use `performance.timeOrigin + MediaRecorder start` and the first `dataavailable`; accept ±1 frame.

### 5.7 HUD / overlays behaviour
- HUD position persisted per display. Draggable via `-webkit-app-region: drag` on the pill body. Source outline drawn by a per-display overlay window (transparent, click-through) using bounds from `listSources` (refresh 4Hz while HUD open).
- Region selector: fullscreen overlay per display; draws selection; snapping to window edges from `listSources` bounds; result in display pixel coordinates + `scaleFactor`.
- Countdown: overlay + HUD collapses; Esc cancels.
- Webcam bubble: live `getUserMedia` preview in its own window; not captured (content protection). Its recorded file is the separate webcam track.
- Recording pill: timer from main's `stats` events; mic level via `AnalyserNode` on the renderer mic stream (Electron backend) or helper-provided RMS (native).

---

## 6. Editor architecture

### 6.1 Windows & loading
`editor` window receives `projectId` via query param. Boot: read `project.json` → validate/migrate → hydrate stores → open sources through `reelform-media://` → build `PreviewVideoSource` (§6.3) → compute waveforms/thumbnails from cache or generate in a worker → if fresh recording and `settings.autoZoomOnNew`, run auto-zoom and present suggestions (§8).

### 6.2 State
Zustand stores with immer. `project` store holds the document; **all mutations go through commands** (`applyCommand({ type, payload, inverse })`) recorded in a history stack (cap 100, coalesce slider drags within 300ms into one entry, label for undo tooltip). Selectors are memoized; timeline uses `useSyncExternalStore` slices per track to avoid re-rendering 500 items on playhead move. Playhead time lives in a separate `playback` store updated via `requestAnimationFrame`, never through commands.

### 6.3 Preview video source
- Primary: `<video>` element (hidden) per source (screen, webcam), synchronized to the playback clock, drawn into Pixi textures each frame (`Texture.from(video)` with `updateFrame`). Speed regions change `playbackRate` (0.25–8, `preservesPitch` per setting). Trims implemented by seeking at clip boundaries; use `requestVideoFrameCallback` for accurate frame timing.
- Scrubbing: seek with `fastSeek` when dragging, precise `currentTime` on release. For frame-step: precise.
- Optional proxy: for sources > 1440p or > 30 minutes, generate a 1080p H.264 proxy in the background (ffmpeg) into `cache/proxy.mp4`; preview uses proxy, export uses original. Toggle in top bar (Auto/Full/Half).
- Quality parity: the same `SceneBuilder` (§6.4) drives preview and export; only the frame source differs (video element vs decoded `VideoFrame`).

### 6.4 Scene graph (Pixi)
```
Stage
 └ FrameRoot (aspect-ratio box, letterboxed in canvas)
    ├ BackgroundLayer   (wallpaper sprite / color / gradient mesh / image; BlurFilter)
    ├ ContentGroup      (padding/inset transform; drop shadow via pixi-filters DropShadow or pre-rendered 9-slice)
    │   └ CameraContainer   (zoom transform: scale + pivot; this is what zoom regions animate)
    │       ├ VideoSprite (masked with rounded-rect/squircle mask; crop applied via texture frame)
    │       ├ AnnotationLayer (followZoom=true items)
    │       └ CursorSprite (+ motion-blur ghost sprites, click effect graphics)
    ├ AnnotationLayerFixed (followZoom=false items)
    ├ WebcamBubble (masked sprite, border, shadow; zoom-reactive scale)
    ├ CaptionLayer (Pixi Text / BitmapText with word highlight)
    └ TitleCardLayer (intro/outro)
 ColorFilters (brightness/contrast/saturation), Vignette, Grain (shader) applied to FrameRoot
```
`SceneBuilder.update(tMs)` is pure with respect to project state + `tMs`: it evaluates all time-based values (camera transform, cursor position, annotation visibility/animation, caption text, webcam visibility) and mutates display objects. Determinism is a requirement for export parity — no `Date.now()`, no frame-delta-based animation; all easing is a function of `tMs`.

### 6.5 Camera / zoom math (`preview/camera.ts`)
- For time `t`, find active zoom region(s). Zoom level `z(t)` eases from 1 → level over `easeInMs` (curve: ease-out cubic default, spring = damped sine, linear) and back over `easeOutMs`. Overlapping regions are disallowed by the model (snapping prevents; merge on drop).
- Focus point `f(t)`: `fixed` → region's (x,y) in 0..1 content coords; `follow` → smoothed cursor position (`motionSmoothing.ts`: one-euro filter with `camera.smoothing` mapping to cutoff; clamp velocity by `maxZoomSpeed`); focus is clamped so the visible rect stays inside content bounds.
- Transform: `scale = z`, `pivot = f * contentSize`, `position = contentCenter`. Optional 3D tilt: apply a small perspective skew proportional to camera velocity (Effects → tilt).
- Webcam zoom-reactive: bubble scale = `1 / (1 + (z-1)*0.5)`.

### 6.6 Cursor rendering (`preview/cursorRenderer.ts`)
- Input: telemetry points; resample to 240Hz with Catmull-Rom; smoothing via one-euro (Snappy⟷Silky maps min-cutoff 5→0.5 Hz). Position for time `t` = interpolated smoothed sample.
- Cursor type from telemetry (`arrow|ibeam|hand|resize-*|grab`) picks the sprite from the selected style pack; hotspot metadata per sprite.
- Size: base 32px @1x × size% × (1/z) so the cursor keeps apparent size while zoomed (setting: "scale with zoom" off by default).
- Motion blur: draw N=6 ghost sprites along the last 40ms of trajectory with decaying alpha, amount → N and spread.
- Click effects: on `clicks[].down` spawn ripple (expanding ring 300ms) / bounce (scale 1→0.85→1 over 180ms) / highlight ring (persistent during hold). Click sound scheduled in the audio graph at the same `tMs`.
- Sway: when idle > 600ms, add Perlin-noise drift of ≤ 3px. Hide-idle: fade out after `delay`, fade in on move.
- Loop mode: last 500ms interpolates cursor back to its position at `t=0` so GIF loops seamlessly.
- No telemetry → cursor layer disabled; UI explains.

### 6.7 Timeline
- Virtualized rendering (only visible items), `dnd-timeline` or custom pointer-event engine (decide in M2 spike; custom preferred for snapping control).
- Time ↔ pixel via `scale = pxPerMs`; zoom range 5s…full; ⌘-scroll zooms around cursor; ruler ticks adapt (frames at ≥ 200px/s).
- Snapping (toggle, default on, alt to bypass): playhead, item edges on all tracks, clip boundaries, 1s grid (when zoomed out), captions word boundaries (when dragging captions). Snap tolerance 6px.
- Constraints per track: zooms and speeds cannot overlap on their own track; annotations/captions may. Dragging into overlap shows red outline and rejects on drop (or trims neighbour if shift held).
- Operations (all commands): move, resize, split (S), trim to playhead ([ ]), ripple delete (delete selected clip range and shift everything), delete, duplicate (alt-drag / ⌘D), nudge ±1 frame (←/→ with item selected), align selection start, marquee, select all on track.
- Video track shows filmstrip thumbnails (generated every 2s of source at 160px height, cached) and a mini waveform.
- Trimmed-out ranges are removed from timeline time (ripple by default; the "Video" track is a sequence of clips).

### 6.8 Inspector
One React component per tab receiving selection + project slices; edits dispatch commands; sliders use `onChangeCoalesced`. The inspector auto-switches to the tab of the selected item kind (setting to disable). Multi-select shows a summary with common actions.

### 6.9 Keyboard & shortcuts
Central `shortcuts.ts` registry: `{ id, scope:'global'|'editor'|'timeline'|'canvas', default: {mac, win}, action }`. Editor consumes via a `ShortcutsProvider` respecting focus (never fire while typing in inputs). User overrides persisted in settings; conflicts detected at edit time.

---

## 7. Commands & history

```ts
type Command = { id: string; label: string; do(state: Draft<Project>): void; undo(state: Draft<Project>): void; coalesceKey?: string };
```
`history.push(cmd)` executes and records; `coalesceKey` merges consecutive commands with the same key within 300ms (slider drags). Undo/redo update `modifiedAt` and dirty flag. History is per project window and not persisted.

---

## 8. Auto-zoom engine (`editor/autozoom/`) — pure TypeScript, unit-tested

Inputs: telemetry (points/clicks/keys/scrolls), content size, clips (to ignore trimmed ranges), sensitivity 0..1, options (zoomOnClicks, zoomOnTyping, followCursor).
Pipeline:
1. **Normalize & clean**: drop points outside 0..1, resample to 60Hz, compute velocity.
2. **Candidate events**:
   - *click*: each `down` → candidate (strength 1.0; double-click 1.2; right-click 0.6).
   - *typing*: key bursts (≥ 3 keys within 1.5s) → candidate at burst start with focus at last click position (strength 0.9).
   - *dwell*: cursor speed < `DWELL_MOVE_THRESHOLD` (0.02 units/s) for ≥ 450ms and ≤ 2600ms → candidate (strength 0.5 × dwell duration factor).
   - *scroll*: scroll bursts → candidate at cursor (strength 0.4).
   - *text-selection*: mouse down→drag→up with small vertical movement → candidate spanning the drag (strength 0.8).
3. **Score**: `strength × sensitivityWeight`; suppress candidates within 800ms of a stronger one (non-max suppression); ignore candidates inside trimmed ranges.
4. **Regionize**: each surviving candidate → region `[t-400ms, t+1800ms]`; merge regions whose focus points are within 0.15 units and gaps < 700ms; extend region end to the last activity in the cluster + 900ms; cap region length 12s; min gap between regions 1200ms (else merge with weighted focus).
5. **Level**: based on cluster spread — tight clusters → 2.2×, wide → 1.5×; clamp 1.3–2.6; sensitivity nudges ±0.3.
6. **Focus**: `fixed` at cluster centroid, or `follow` when `followCursor` and cluster spread > 0.2.
7. **Easing**: in 600ms, out 700ms, ease-out cubic; if region shorter than 2s, 400/500.
Output: `SuggestedZoom[]` with `source:'auto'` + `reason` (for the tooltip "Zoomed because: 3 clicks"). UI presents as ghosts; "Keep all" commits as one command; "Review" steps through with keep/skip; regenerate replaces only `source:'auto'` regions the user has not edited (edited ones get `source:'manual'`).
Tests: fixtures of 12 labelled recordings; assert precision/recall ≥ 0.8 vs hand-labelled zooms; property tests for no overlaps and bounds.

---

## 9. Feature specs (per inspector tab)

### 9.1 Frame
- Backgrounds: bundled wallpapers (`public/wallpapers/*.jpg` 2560×1600, ≥ 40, with `wallpapers.json` metadata; discovered at runtime so packs can be added; shipped as extraResources, lazy-loaded), solid color, linear/radial gradient (2–4 stops, angle), user image (copied into project `media/`), none (transparent → export with alpha for WebM/GIF, black for MP4).
- Blur 0–40px (Kawase blur for performance), padding 0–200 (uniform or per-side), radius 0–64 + squircle (superellipse mask n=4, generated via `geometry/squircle.ts`), shadow (strength/offset/blur/color — implemented as pre-rendered soft rect texture scaled, not per-frame Gaussian), border, aspect presets + custom, inset 50–100%, crop (source rect; UI on canvas; aspect lock).
- Presets: 5 bundled + user presets stored in settings; "Apply preset" is a single command.

### 9.2 Cursor — see §6.6; style packs: `assets/cursors/<pack>/{arrow,ibeam,hand,grab,resize-ew,resize-ns,resize-nesw,resize-nwse}@2x.png + pack.json (hotspots)`; custom = user PNG/SVG for arrow only.
### 9.3 Zoom — see §6.5/§8. Manual add = 2s region at playhead with focus at cursor position at that time (from telemetry) or center.
### 9.4 Webcam
- Track from recording or imported file (copied into `media/`). Bubble mask shapes; position 3×3 + custom; margin; mirror; border; shadow; corner radius; zoom-reactive; visibility regions on timeline (default whole).
- Crop/reframe: stored as `{ x, y, w, h }` in source coords; "Center on face" uses a lightweight face detector (`@mediapipe/tasks-vision` face detection run once on 10 sampled frames; ships as wasm ~3MB) — if it fails, center.
- Sync: `syncOffsetMs` applied to webcam playback; "Auto-sync" cross-correlates webcam audio (if any) with mic track over the first 30s in a worker.

### 9.5 Audio
- Graph (Web Audio, `OfflineAudioContext` for export): sources (mic, system, extra regions, click sounds) → per-track gain → optional processors → master gain → destination.
- Noise reduction: RNNoise (wasm, `@jitsi/rnnoise-wasm`) as an `AudioWorklet` on the mic track; export runs it offline; preview toggles live.
- Normalize: measure integrated loudness (EBU R128 via a worker on first enable) and apply gain to −16 LUFS; limiter (`DynamicsCompressor` with hard knee) on master.
- Fades linear/equal-power; ducking: sidechain envelope from mic RMS (attack 50ms, release 400ms) reduces music gain by `amount` dB.
- Speed regions: `playbackRate` on media elements for preview; for export, resample via `OfflineAudioContext` with pitch-keep using a phase-vocoder worklet (`soundtouchjs`) when `keepPitch`.
- Click sounds: 3 bundled packs (`assets/sounds/`), scheduled at click `tMs` through the same graph.

### 9.6 Captions
- Runtime: whisper.cpp `whisper-cli` binary per platform built in CI (`scripts/build-whisper-runtime.mjs`: clones pinned tag, cmake with `-DWHISPER_METAL=ON` on mac, `-DGGML_CUDA=OFF` by default on win (CPU + optional Vulkan build shipped as separate binary when size allows), `-DWHISPER_OPENMP=ON`). Models: `ggml-tiny.en-q5_1` (Fast, ~32MB), `ggml-base-q5_1` / `ggml-small-q5_1` (Balanced, ~190MB), `ggml-medium-q5_0` (Accurate, ~540MB) — display rounded sizes; downloaded from Hugging Face with sha256 verification into `userData/models`, resumable.
- Pipeline (main): extract audio candidate (mic preferred, else system, else video audio) → ffmpeg to 16kHz mono WAV of the **timeline range** (after trims/speeds, so timestamps match) → silence split into ≤ 5-minute chunks → run whisper with `--output-json-full` for word timestamps → parse → segment into captions (max 42 chars/line, max 2 lines, min 700ms, split on punctuation and pauses > 350ms) → return segments with words.
- Editing model: list rows bound to `captions[]`; enter splits at caret with proportional time split (word-aware); backspace-at-start merges; drag on timeline adjusts times; word-level retiming by dragging word chips (v1.1).
- Styles: preset + font (system list + custom fonts registered via `FontFace` from files copied into `media/fonts/`), size, colors, background pill, position, max lines, uppercase, word highlight (karaoke: current word color swap by word timestamps).
- Export: burn-in via `CaptionLayer` in the scene; sidecar `.srt`/`.vtt` written beside the export; both options simultaneously allowed.
- Import: drop `.srt/.vtt` → parse to captions.

### 9.7 Annotations
Union: `text | arrow | line | rect | ellipse | highlight | blur | image | emoji | numberBadge | keystrokeBadge`. Common: `{ id, kind, startMs, endMs, x, y, w, h, rotation, followZoom, animIn:{type,ms}, animOut:{type,ms}, opacity }`; per-kind props per the design guide. Rendering: Pixi Graphics/Text/Sprite; blur/pixelate uses a masked `BlurFilter`/`PixelateFilter` applied to a copy of the video sprite region (in `CameraContainer` so it tracks content). Canvas transform handles via a `TransformGizmo` (move, 8 resize, rotate). Keystroke badges: `annotations/keystrokes.ts` groups `keys[]` into chords (modifier + key within 80ms) and shortcuts (≥ 1 modifier), produces badge candidates with platform glyphs (⌘⌥⇧⌃ / Ctrl Alt Shift Win); "Add all" creates badges of 1.2s at bottom-center; letter keys without modifiers are never shown (privacy — telemetry stores key codes only while recording, and plain typing is discarded at finalize unless the user opts into "Record typed text badges", off by default).

### 9.8 Effects
- Speed regions (§4, §9.5). Remove silence: analyze mic (or system) RMS with threshold (dBFS) + min length → produces clip cuts (ripple) as one command with preview count. Auto speed-up idle: ranges with cursor speed < ε and no keys/clicks for > 3s → speed regions at 3× with 300ms ramps.
- Transitions at clip boundaries: none / cross-dissolve (needs 2 video textures around the cut — render the second clip's first frame via an extra hidden video element) / cut-with-zoom (quick 1.15× ease).
- Intro/outro title cards: text + background (frame background by default) + duration; timeline gets prepended/appended time.
- Color: brightness/contrast/saturation (ColorMatrixFilter), vignette (shader), grain (animated noise shader, seeded by frame index for determinism), 3D tilt (§6.5), parallax (background offset proportional to camera pivot delta).

### 9.9 Project tab & media management
Relink: pick a new file; validate duration ± 1s and dimensions; rewrite path. "Trim source to used range": ffmpeg `-c copy` cut with 1s handles into `media/`, rewrite clips, move original to trash folder (undo-able until app quit). Delete project: move `.reelform` folder to OS trash.

---

## 10. Export pipeline (`src/export/`)

### 10.1 Routes
`selectRoute(config, project, caps)` → one of:
1. **`webcodecs`** (default, all platforms): renderer renders each frame with the Pixi `SceneBuilder` into an offscreen render texture → `VideoFrame` → `VideoEncoder` → `mediabunny` muxer (MP4/WebM) streaming chunks to main (`export:writeChunk`) → file. Audio via `OfflineAudioContext` → `AudioEncoder` (AAC via WebCodecs if available; else Opus for WebM; else PCM WAV then ffmpeg AAC) muxed with proper timestamps.
2. **`native-static`** (fast path): when the project has no zooms/cursor/annotations/webcam/captions/speeds (i.e., only frame styling + trims), build an ffmpeg filter graph (`scale`, `pad`, rounded-corner mask via `geq` or pre-rendered PNG overlay, `overlay` background, `drawbox` shadow approximation) with hardware encoders (`h264_videotoolbox`, `h264_nvenc`, `h264_qsv`, `h264_amf`) — 5–10× faster for the "just make it pretty" case.
3. **`software-fallback`**: same as 1 but with `VideoEncoder` `hardwareAcceleration:'prefer-software'`; auto-selected when HW encoder config is rejected or errors mid-export (resume from last keyframe chunk boundary is not attempted — restart whole export, but reuse decoded frames cache when small).

### 10.2 Frame source
`StreamingDecoder`: demux source via `mediabunny` (or `mp4box` fallback) → `VideoDecoder` with backpressure (`decodeQueueSize ≤ 8`) → ordered `VideoFrame`s keyed by PTS. Seeking to clip starts uses nearest preceding keyframe and discards. Speed regions decode every source frame and pick nearest to timeline time; for rates < 1 frames are repeated (no interpolation in 1.0). Frames are uploaded to a Pixi texture, rendered, and **closed immediately**.

### 10.3 Timing & determinism
Output frame `i` has `tMs = i * 1000/fps`; scene evaluated at `tMs` — identical to preview evaluation. Encoder timestamps in microseconds from `tMs`; keyframe every 2s (`keyFrame: true`); `latencyMode:'quality'`; bitrate from `exportBitrate.ts` table (1080p60 High = 16 Mbps H.264, Max = 28; HEVC ×0.65; AV1 ×0.5) or CRF-like `quantizer` when supported.

### 10.4 Color
Source frames decoded as-is; render in sRGB; `VideoEncoder` config `colorSpace: { primaries:'bt709', transfer:'bt709', matrix:'bt709', fullRange:false }`; muxer writes `colr` atom. Golden tests compare a mid-gray + saturated patch between source, preview screenshot and decoded export (ΔE < 3).

### 10.5 Audio
Build the audio graph offline for the whole timeline (or range), render to `AudioBuffer` in 30s blocks to bound memory, encode AAC-LC 192k (48kHz stereo). A/V alignment test: 1kHz beep at t=10s in fixture must land within 20ms in the exported file.

### 10.6 GIF
Render at selected size/fps → frames into a worker: global palette (median-cut on a 10% frame sample, or per-frame when "adaptive") with optional Floyd–Steinberg/Bayer dithering, transparent-pixel frame differencing, LZW encode (`gifenc`-style implementation in TS, no `gif.js` in 1.0), loop flag. Show estimated size live from the first 2s.

### 10.7 Progress, cancel, finalize
Progress = frames encoded / total, ETA from EMA of frame time, phase labels (Preparing, Rendering, Encoding audio, Muxing, Finalizing). Cancel aborts decoder/encoder, deletes temp. Finalize: `export:finish` moves temp to destination (unique name on collision), writes sidecars, optionally copies to clipboard (mac: `NSPasteboard` file URL; win: `CF_HDROP` via Electron `clipboard.writeBuffer` fallback), reveals in file manager, toast with actions.

### 10.8 Performance targets
1080p60, 60s project, M1: WebCodecs route ≤ 30s (HW), fallback ≤ 90s. Memory ≤ 1.5GB peak. The exporter must never hold more than 12 decoded frames + 30s of audio.

---

## 11. Settings, shortcuts, updater, onboarding

- Settings store in main (`electron-store`-like JSON with schema + migrations at `userData/settings.json`), mirrored to renderers via `settings:get/set/changed`. Keys per design guide S24.
- Global shortcuts via `globalShortcut` registered from settings; conflicts validated.
- Updater: `electron-updater` with GitHub provider; channels via `allowPrerelease`; check on launch + every 6h; download in background; "Restart to update" in launcher banner + Settings; release notes from GitHub release body.
- Onboarding: state machine `welcome → permissions → defaults → done`; re-entered from Settings; permission status polled every 2s while on that screen (`systemPreferences.getMediaAccessStatus`, `CGPreflightScreenCaptureAccess`, Accessibility via `systemPreferences.isTrustedAccessibilityClient`).
- Tray/menu bar: template icon; red dot while recording.
- File associations: `.reelform` (package on mac with UTI), `reelform://open?path=` deep link.

---

## 12. Extensions (1.2 — design now, build later)

Manifest `reelform-extension.json` `{ id, name, version, description, author, license, main, permissions:['render','timeline:read','settings','audio','files'], contributes:{ wallpapers, cursorPacks, sounds, frames } }`. Loaded in the editor renderer inside a sandboxed iframe (`sandbox="allow-scripts"`) communicating via `postMessage` RPC; `render` hooks receive an `OffscreenCanvas` layer per frame with `{ tMs, width, height }`, not the full scene. Assets-only extensions (wallpapers/cursors/sounds) require no JS and no permissions. Install from zip (validated: size < 50MB, no symlinks, manifest schema) or marketplace URL. Keep the API surface tiny in 1.2; version it.

---

## 13. Security & privacy

- Renderer sandboxed; no `remote`; CSP strict; only `reelform-media://` for local files; `webSecurity` on.
- Helpers are signed and hash-verified; spawned with minimal args; no shell.
- Telemetry key events: codes only, only while recording, discarded at finalize unless the user opts in per §9.7; never characters, never outside recording.
- Captions run on-device; model downloads verified; no audio leaves the machine.
- Crash reports/usage stats opt-in; scrub paths; documented in privacy page.
- Project files may contain screen content — treat as sensitive: no cloud sync in 1.0; "Clear cache" and "Delete project" fully remove data.

---

## 14. Quality: testing, CI, release

### 14.1 Tests
- Unit (Vitest): time math, clips↔source mapping, snapping, commands/history, auto-zoom (with fixtures + fast-check properties), caption segmentation, GIF palette, bitrate tables, route selection, schema migrations.
- Golden frames: render fixture projects at 5 timestamps via the export path in headless Electron; compare to committed PNGs (perceptual hash + per-pixel tolerance) — run on each OS in CI.
- Media integration: record 10s via Electron backend in CI (xvfb on Linux; virtual display on Windows runner; mac runner real display) → assert file playable, duration ± 100ms, telemetry aligned.
- E2E (Playwright-Electron): launcher → record 5s → editor opens → accept suggestions → export MP4 → file exists and ffprobe reports expected dims/fps/duration.
- Native helper tests: `ping`, start/stop 3s capture, pause/resume continuity, interrupted display (mac: simulated via `SCStream` stop), WASAPI device loss.
- Soak (nightly): 60-min recording; 30-min export; memory graphs uploaded as artifacts.
- Performance CI: preview fps and export time measured on self-hosted M1 and a Windows NVIDIA box; regressions > 10% fail the job.

### 14.2 CI pipeline (`.github/workflows/`)
`ci.yml` on PR: lint, typecheck, unit, golden (3 OS). `build.yml` on tag: build native helpers (Swift on macos runners x64+arm64, CMake/MSVC on windows), build whisper runtime, vite build, electron-builder per OS, sign (mac: Developer ID + notarize via `notarytool`, staple; win: EV cert via Azure Key Vault/`signtool`), smoke-run packaged app (`--smoke` flag launches, checks helpers `ping`, exits 0), checksums + SLSA attestation, upload to GitHub Release (draft), publish `latest.yml`/`latest-mac.yml` for updater. `nightly.yml`: soak + perf.

### 14.3 Release process
Version bump PR → tag `vX.Y.Z` → build.yml → QA checklist on the draft release (record on 3 OS, export MP4/GIF, update from previous version, permissions revoke/regrant, fresh install onboarding) → publish to Beta → 3 days → promote to Stable (same artifacts, flip prerelease). Hotfix: branch from tag.

### 14.4 Definition of done (per feature)
Design parity with the guide (dark+light) · keyboard accessible · unit tests for logic · golden/e2e where visual · no new lint errors · telemetry events named (if any) · docs/strings externalized · works on all 3 OSes or explicitly gated with UI messaging · performance within budget.

---

## 15. Milestone-to-module map (mirrors PLAN §7)

| Milestone | Modules to land |
|---|---|
| M0 | repo, tokens/components, IPC contracts, schema v1 + validation, settings store, logger/diagnostics, CI unsigned builds, launcher shell |
| M1 | `capture/electronBackend`, HUD/overlays/region/countdown/bubble windows, telemetry via uiohook, session lifecycle, finalize/remux, post-record dialog; native `sck` + `wgc` helpers + cursor monitors (parallel) |
| M2 | media protocol, preview source, Pixi scene, camera/cursor renderers, timeline core, Frame/Cursor/Zoom tabs, commands/history, autosave/backups, project browser, auto-zoom engine |
| M3 | streaming decoder, WebCodecs route, muxer, audio offline graph + AAC, GIF worker, WebM, native-static route, encoder probe, progress/cancel/finalize, golden parity tests |
| M4 | webcam, audio tab (RNNoise, normalize, ducking), captions runtime+UI+styles+sidecars, annotations incl. keystroke badges, effects, crop, settings pages, shortcuts editor, onboarding, updater, tray |
| M5 | test matrix, soak, a11y, light theme, i18n, crash reporting, signing/notarization, installers, docs |
| M6 | RC, beta channel, launch |

---

## 16. Open questions to close in M0 (owner: tech lead)
1. Custom timeline engine vs `dnd-timeline` — 2-day spike, decide by snapping fidelity and virtualization.
2. AAC via WebCodecs availability on Linux Chromium builds — if absent, confirm ffmpeg AAC finalize step cost.
3. HEVC/AV1 `VideoEncoder` support matrix on target GPUs — determines Export dialog codec options at launch.
4. Whisper Vulkan build size on Windows — ship or CPU-only.
5. Face detection dependency size vs. value for "Center on face" — keep or defer to 1.1.
