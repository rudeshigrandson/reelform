# Reelform

Desktop screen recorder and demo-video editor for macOS, Windows and Linux.
Record your screen, and Reelform makes it look designed: auto-zoom that follows
your clicks, backgrounds and frames, a smooth cursor, on-device captions,
annotations and keystroke badges, then exports MP4, WebM or GIF.

Local-first: no account, and no recordings leave your machine. See
[docs/PRIVACY.md](docs/PRIVACY.md).

- **User guides:** [Getting started](docs/user/getting-started.md) ·
  [Shortcuts](docs/user/shortcuts.md) ·
  [Troubleshooting permissions](docs/user/troubleshooting-permissions.md) ·
  [FAQ](docs/user/faq.md)
- **Contributors:** [Architecture](docs/ARCHITECTURE.md) ·
  [Contributing](docs/CONTRIBUTING.md) · [Releasing](docs/RELEASING.md) ·
  [Decision records](docs/ADRs/)

## Stack

Electron 33, React 18, PixiJS 8 and TypeScript (strict), built with Vite 5 and
packaged by electron-builder 26. Exports encode with WebCodecs on the GPU;
ffmpeg is only a fallback for muxing and transcoding. Native helpers (Swift on
macOS, C++ on Windows) handle capture that Chromium can't do. Captions run on
your machine with whisper.cpp.

## Requirements

- Node.js 22 and npm
- macOS 14+, Windows 10 (19041)+, or Linux with glibc 2.31+ (PipeWire for system audio)
- Optional, only to build native pieces yourself:
  - macOS: Xcode command-line tools (Swift) for the capture helpers; CMake for whisper.cpp
  - Windows: Visual Studio 2022 with C++ and CMake for the helpers and whisper.cpp
  - Linux: CMake and a C++ toolchain for whisper.cpp

## Develop

```sh
npm ci                 # install dependencies
npm run dev            # Vite dev server + Electron with hot reload
```

The renderer also opens in a plain browser tab (outside Electron): IPC calls
resolve to safe fallbacks, so most UI can be built without the desktop shell.

### Native pieces (optional in dev, required for release builds)

```sh
npm run native:build   # Swift (macOS) / C++ (Windows) capture helpers → electron/native/bin/<platform>-<arch>/
npm run whisper:build  # whisper.cpp whisper-cli → resources/whisper/<platform>-<arch>/ (+ LICENSE.txt, SOURCE.txt)
npm run ffmpeg:fetch   # pinned, sha256-verified FFmpeg 9.0.1 → resources/ffmpeg/<platform>-<arch>/ (+ LICENSE.txt, SOURCE.txt)
```

Without the helpers Reelform uses the Chromium capture backend. Without
whisper-cli, captions show a "runtime missing" state. Without ffmpeg, only the
fallback export routes are unavailable.

`npm run whisper:build -- --arch x64 --vulkan` builds the optional Vulkan
variant on Windows/Linux. `npm run ffmpeg:fetch -- --target win32-x64` stages
another platform's ffmpeg. `--print-hash` prints a new archive's sha256 without
installing it.

### Generated assets

```sh
npm run assets         # icons + click sounds + cursor packs (deterministic; checked by tests)
node scripts/generate-licenses.mjs   # THIRD_PARTY_LICENSES.txt from production dependencies
```

## Test and check

```sh
npm test               # Vitest, all unit and component tests
npx vitest run src/settings          # one folder
npm run test:watch     # watch mode
npm run lint           # Biome lint + format check
npm run lint:fix       # apply Biome fixes
npm run typecheck      # tsc --noEmit
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests and a Vite build on
macOS, Windows and Linux for every pull request.

## Package

```sh
npm run dist           # build + electron-builder for the current OS
npm run dist:mac       # universal .dmg + .zip
npm run dist:win       # NSIS installer (x64)
npm run dist:linux     # AppImage (x64)
```

Output lands in `release/<version>/`. Run `node scripts/generate-licenses.mjs`
first so `THIRD_PARTY_LICENSES.txt` is current; electron-builder ships it with
`LICENSE` and `NOTICE.md` in `<resources>/licenses/`. Signed releases are built
by CI from a version tag; see [docs/RELEASING.md](docs/RELEASING.md).

## Repository layout

```
electron/     main process: windows, IPC handlers, capture, recording, export finalize,
              captions runtime, settings, updater, tray, permissions, diagnostics
  native/     Swift / C++ helper sources and built binaries (bin/<platform>-<arch>)
src/          renderer (React + PixiJS)
  app/        per-window wiring (IPC adapters, stores)
  design/     tokens, theme, shared components
  editor/     preview scene, timeline, inspector tabs, auto-zoom, state and commands
  export/     WebCodecs export engine, routes, GIF encoder
  i18n/       translator and locales/en.json
  launcher/ onboarding/ hud/ overlays/ recording/ projects/ settings/ shortcuts/
scripts/      build, fetch and asset-generation scripts
docs/         architecture, contributing, releasing, privacy, ADRs, user guides
```

## License

Reelform is MIT-licensed (see [LICENSE](LICENSE)). Third-party components and
their licenses are listed in [NOTICE.md](NOTICE.md). The bundled FFmpeg
binaries are GPLv3; their source offer ships beside them.
