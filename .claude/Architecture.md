# Architecture

## Processes

```
┌──────────────────────────────────────────────┐
│ Electron Main                                  │
│  - window/lifecycle, permissions               │
│  - filesystem, project store                   │
│  - spawns native capture helpers               │
│  - ffmpeg (mux / transcode fallback)           │
└───────────────┬────────────────────────────────┘
                │ typed IPC
┌───────────────┴────────────────────────────────┐
│ Renderer (React + PixiJS)                        │
│  - UI (React), timeline, editor                  │
│  - GPU compositing / render (PixiJS, WebGPU)     │
│  - WebCodecs encode (primary path)               │
│  - on-device Whisper (captions)                  │
└──────────────────────────────────────────────────┘
                │
┌───────────────┴────────────────────────────────┐
│ Native capture helpers (per OS)                  │
│  - screen / window / cursor capture              │
│  - system audio                                  │
└──────────────────────────────────────────────────┘
```

## Pipelines

- **Capture** → native helper streams frames + audio → main → renderer.
- **Edit** → PixiJS scene graph on GPU (zoom, background, cursor, annotations).
- **Export** → WebCodecs encodes GPU frames; ffmpeg muxes/transcodes as needed.
- **Captions** → local Whisper transcribes audio → editable caption track.

## Data

- Local-first project files. No accounts in 1.0. Sharing links = 1.x, never required.

## Reference architecture

OpenScreen (MIT, https://github.com/siddharthvaddem/openscreen) and Cap
inform the cross-platform capture + native-helper approach. See `NOTICE.md`.

> Fill in module paths, IPC channel list, and file layout as code lands.
