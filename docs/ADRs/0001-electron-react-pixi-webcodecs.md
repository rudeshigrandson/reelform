# ADR 0001: Electron + React + PixiJS, WebCodecs first, ffmpeg second

- **Status:** Accepted
- **Date:** 2026-01 (M0)
- **Source:** PLAN §11 decisions 1–3; ENGINEERING_SPEC §0

## Context

Reelform must ship the same editor on macOS, Windows and Linux with a small
team. The editor composites every frame (background, zoom camera, cursor,
webcam, captions and annotations) on the GPU, and exports must match the
preview pixel for pixel.

## Decision

- **Shell:** Electron (≥ 33), React 18 for UI, and PixiJS 8 (WebGPU, then
  WebGL2) for the preview scene graph. We rejected native SwiftUI/WinUI (three
  codebases) and Tauri (system webviews differ, and WebCodecs/WebGPU support
  varies).
- **Encode:** the export engine renders through the same Pixi scene and encodes
  with WebCodecs (`VideoEncoder`/`AudioEncoder`), muxing with mediabunny.
  ffmpeg is bundled only for muxing and transcoding fallbacks and the
  static-layout fast path, never as the primary encoder.
- **Native helpers** (Swift ScreenCaptureKit on macOS, C++ WGC on Windows)
  handle capture Chromium can't do. They are stand-alone executables speaking
  line-delimited JSON over stdio, and Chromium capture is always available as
  a fallback.
- **Local-first:** no accounts in 1.0.

## Consequences

- One renderer codebase, and preview and export share rendering code
  (golden-frame parity tests).
- App size and memory follow Electron's; whisper and wallpapers load lazily.
- ffmpeg is GPL-3.0 and shipped as separate executables with a source offer
  (see NOTICE.md).
