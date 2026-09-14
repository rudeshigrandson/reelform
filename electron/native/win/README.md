# Reelform Windows native helpers

Source for the Windows capture helpers described in ENGINEERING_SPEC §5.4/§5.5.
Main (`electron/capture/wgcBackend.ts`, `helperProcess.ts`) spawns them. The
renderer never talks to them directly.

> **Status: the helper executables have NOT been compiled or run yet.** They
> were written on macOS, which has no MSVC or Windows SDK. The header-only core
> (`common/include/reelform/*`) and its tests *are* compiled and pass with
> clang (C++17 and C++20, ASan/UBSan, `-Werror`). Build and test everything
> below on Windows before shipping.

| Executable | Purpose |
|---|---|
| `reelform-wgc.exe` | Windows.Graphics.Capture (monitor/HWND) → GPU crop → Media Foundation H.264 `screen.mp4`; WASAPI loopback → `system.m4a`; WASAPI mic → `mic.m4a`; `meta.json` |
| `reelform-dxgi.exe` | Same pipeline with a DXGI Desktop Duplication source (Windows builds < 19041). Captures displays and regions only. |
| `reelform-cursor-monitor.exe` | Cursor position at 120 Hz (`GetCursorPos`), clicks and key codes (low-level hooks, only while recording), scroll (raw input) |
| `reelform-hw-probe.exe` | Lists MF video encoders (hardware and software) plus DXGI adapters as JSON. `probe.ts` turns that into the `export:probeEncoders` response. |
| `reelform-native-tests` | Portable tests for the header-only core |

## Layout

```
common/include/reelform/   header-only core, no Windows deps (unit tested)
  json.hpp                 JSON value/parser/serializer (exact int64)
  protocol.hpp             stdio protocol: command parsing, outbound builders
  session_state.hpp        idle → starting → recording ⇄ paused → stopping → stopped
  timing.hpp               QPC conversion, MediaClock (pause offsets), AudioAligner, FpsMeter, TickSchedule
  capture_math.hpp         region clamp/even sizes, GPU copy plan, bitrate table, monitor resolution
  meta.hpp                 meta.json builder
  cursor.hpp               cursor-monitor event lines, key repeat/modifier state
  hw_probe_report.hpp      hw-probe JSON report (+ sample used as the TS fixture)
  line_io.hpp              non-blocking line writer, bounded line splitter
common/win_util.hpp        UTF-8/16, QPC, process init (Windows)
common/reelform-helper.manifest   PerMonitorV2 DPI, Win10 supportedOS, asInvoker
wgc-capture/               reelform-wgc + reelform-dxgi (shared recorder, MF writers, WASAPI)
cursor-monitor/            reelform-cursor-monitor
hw-probe/                  reelform-hw-probe
tests/                     test_main.cpp (minimal asserts) + fixtures/
probe.ts, probe.test.ts    TS parser for the hw-probe report (vitest)
```

## Protocol

UTF-8, one JSON object per line on stdin and stdout, `{"t": "<type>", "id"?: n, ...}`.
The full grammar is documented at the top of `common/include/reelform/protocol.hpp` and `cursor.hpp`.

**Wire-compatible with the macOS helpers.** Every outbound line validates against the zod schemas
in `electron/native/mac/protocol.ts` (`SckEvent`, `CursorEvent`), and the mac `start` shape
(`source:{kind,displayId|windowId}`) is accepted. `protocol-compat.test.ts` checks this against lines
emitted by the C++ builders (`tests/fixtures/protocol-sample.txt`, regenerate with `--emit-protocol-fixture`).

- In: `ping`, `start`, `pause`, `resume`, `stop`, `discard`. Windows extensions on `start`: `source.bounds` (used to pick the monitor, since Electron display ids do not map to HMONITORs) and `hideCursor`.
- Out: `ready` (once, at launch), `pong{version,caps}`, `started{firstFramePtsNs,startHostTimeNs,width,height,scaleFactor}` (echoes the start `id`), `stats{fps,droppedFrames,fileBytes,micLevel?}` every 1 s, `interrupted{reason,message}`, `stopped{durationMs,paths{screen,system?,mic?,meta?},pausedRanges,discarded}`, `error{code,message,fatal}`.
- `interrupted.reason`: `sourceLost` (window closed, display gone), `streamStopped` (device removed, duplication failed), `deviceLost` (microphone disconnected), `writerFailed` (encoder failure, or disk < 500 MB with a message starting `diskLow:`), `parentGone` (stdin closed).
- `error.code`: `badRequest`, `unknownCommand`, `invalidState`, `permissionDenied`, `sourceNotFound`, `writerFailed`, `streamFailed`, `micUnavailable`, `noFrames`, `internal`.
- A successful `start` is answered by `started` on the first frame. A failed start gets `error` with the start `id`. `pause` and `resume` send nothing on success.
- A helper exits after sending `stopped`. If stdin closes mid-recording, the helper finalizes and sends `interrupted{reason:"parentGone"}` followed by `stopped`. A recording that reached disk is never discarded implicitly.
- Cursor monitor: `start` → `started{hostTimeNs,sampleHz:120,clickSource:"eventTap",keys:true}`, then `move{tNs,x,y,cursor}`, `click{tNs,x,y,button,phase}`, `key{tNs,keyCode,modifiers}`, `scroll{tNs,dx,dy}`; `stop` → `stopped{samples}`. Shapes without a style-pack sprite report `arrow`; X buttons are not reported.
- **Timestamps.** Every `*Ns` value is nanoseconds on the QueryPerformanceCounter clock, which is shared across processes. Main rebases cursor telemetry as `tMs = (hostNs - firstFramePtsNs) / 1e6`.
- **Coordinates.** All helpers are PerMonitorV2 DPI aware.
  - `region` is in physical pixels, relative to the captured monitor's top-left.
  - Cursor coordinates are physical virtual-desktop pixels.

## Build (Windows)

Requirements:
- Visual Studio 2022 with the "Desktop development with C++" workload (plus ARM64 build tools for arm64).
- Windows SDK 10.0.22621 or newer (includes the C++/WinRT headers).
- CMake 3.24 or newer.

```powershell
cd electron\native\win
cmake --preset windows-x64
cmake --build --preset windows-x64-release
ctest --preset windows-x64
cmake --install build\windows-x64 --config Release     # -> electron\native\bin\win32-x64\

cmake --preset windows-arm64                            # cross-compiles from an x64 host
cmake --build --preset windows-arm64-release
cmake --install build\windows-arm64 --config Release   # -> electron\native\bin\win32-arm64\
```

The helpers link the static CRT (`/MT`), so no VC++ redistributable is needed. They use `/guard:cf`, plus `/CETCOMPAT` on x64.

### Portable core tests (any OS, no CMake needed)

```sh
c++ -std=c++17 -Wall -Wextra -Werror -I common/include tests/test_main.cpp -o /tmp/rf-native-tests && /tmp/rf-native-tests
/tmp/rf-native-tests --emit-probe-fixture > tests/fixtures/hw-probe-sample.txt    # regenerate the TS fixture (single line; .txt so formatters leave it alone)
```

With CMake: `cmake --preset host-tests && cmake --build --preset host-tests && ctest --preset host-tests`.

## Signing and release (§13, §14.2)

1. **Build in CI** (`build.yml`, `windows-latest`) for both presets. Run `ctest`, then a smoke test of each exe: `echo {"t":"ping"} | reelform-wgc.exe` must print a `pong`.
2. **Sign every exe before hashing.** Use the EV certificate stored in Azure Key Vault:
   ```powershell
   AzureSignTool sign -kvu $env:AZURE_KV_URL -kvi $env:AZURE_CLIENT_ID -kvt $env:AZURE_TENANT_ID `
     -kvs $env:AZURE_CLIENT_SECRET -kvc $env:AZURE_CERT_NAME `
     -tr http://timestamp.digicert.com -td sha256 -fd sha256 bin\win32-x64\*.exe
   signtool verify /pa /v bin\win32-x64\reelform-wgc.exe
   ```
   Always add an RFC 3161 timestamp (`-tr`) so signatures outlive the certificate.
3. **Write `bin/win32-<arch>/manifest.json`** with the sha256 of each *signed* binary. At startup, main checks the binaries against this manifest; a mismatch marks the backend unavailable, with a reason.
4. **Package the binaries unpacked.** electron-builder must list `electron/native/bin/win32-${arch}/**` under `asarUnpack` (or `extraResources`), because executables cannot be spawned from inside an asar. Main spawns them with `windowsHide: true` and no shell.
5. **SmartScreen.** An EV-signed binary gains reputation immediately. Do not re-sign or modify binaries after hashing.

## Known limitations and open items

- **Not compiled or verified on Windows.** Expect small API or typo fixes on the first MSVC build.
- **Mic device ids.** `audio.mic` must be a WASAPI endpoint id (`IMMDevice::GetId`). Chromium's `getUserMedia` deviceIds are hashed and will not match. An unknown id falls back to the default capture device and emits `error{code:"micUnavailable",fatal:false}`.
- **System audio device change.** A loopback endpoint change mid-recording (for example, headphones plugged in) emits `error{code:"streamFailed",fatal:false}`. Recording continues and the system track is padded with silence. Losing the microphone interrupts with `deviceLost`, as on macOS. Main needs a mapping, e.g. by device label, or a future `listAudioDevices` helper command.
- **System audio includes Reelform's own output.** macOS uses `excludesCurrentProcessAudio`. The Windows equivalent is process loopback via `ActivateAudioInterfaceAsync` with `PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE`, available on build 20348 and later. It is not implemented yet.
- **DXGI backend and the cursor.** Desktop Duplication frames never contain the cursor. `hideCursor:true` is always honoured, and `hideCursor:false` cannot burn the cursor in (caps include `cursorAlwaysHidden`). This differs from the spec wording in §5.4 ("cursor cannot be hidden").
- **DXGI backend limits.** Rotated displays are rejected, and HDR outputs use `DuplicateOutput`, not `DuplicateOutput1`, so colour may be off.
- **Encoder failure mid-recording.** If the hardware encoder fails after start, the helper stops with `interrupted{reason:"encoderFailed"}` and keeps the fragmented MP4. There is no live switch to the software encoder.
- **Variable frame rate.** WGC and DXGI deliver frames only when content changes, so `screen.mp4` has VFR timestamps. The nominal fps is written to the stream and to `meta.json`.
