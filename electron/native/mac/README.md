# macOS native helpers

Swift Package implementing ENGINEERING_SPEC §5.3 (macOS native backend) and the
§5.5 helper protocol. Helpers produce files + telemetry only; no editor
business logic lives here.

| Target | Kind | Purpose |
|---|---|---|
| `ReelformProtocol` | library | Line protocol encode/decode, bitrate table, pause/PTS offset math, session state machine, modifier mapping, cursor classification, `pack.json` |
| `reelform-sck` | executable | ScreenCaptureKit capture → `screen.mp4` (H.264), `system.m4a` (AAC 192k), `mic.m4a` (AAC, AVCaptureSession) |
| `reelform-cursor-monitor` | executable | 120Hz cursor position + type, clicks, key codes, scroll; system cursor PNG export |
| `reelform-protocol-selfcheck` | executable | XCTest-free checks of `ReelformProtocol`; writes/compares `fixtures/protocol-golden.json` |

`protocol.ts` holds the matching zod schemas; main validates every helper line
with them. `protocol.test.ts` validates the golden fixture, so a protocol change
on either side fails a test until both agree.

## Build

Requires Xcode 15+ (macOS 14 SDK or newer). Minimum deployment target: macOS 14.

```sh
cd electron/native/mac
swift build -c release --arch arm64 --arch x86_64     # universal binaries
swift run reelform-protocol-selfcheck                 # 0 failures expected
swift run reelform-protocol-selfcheck --write-golden  # after an intentional protocol change
```

`scripts/build-native-helpers` should copy `.build/apple/Products/Release/reelform-{sck,cursor-monitor}`
to `electron/native/bin/darwin-universal/` and record their sha256 in `manifest.json` (§5.5).

## Protocol

stdio, UTF-8, one JSON object per line. `ready` is emitted once on launch.

**reelform-sck** — inbound `ping`, `start`, `pause`, `resume`, `stop`, `discard`:

```json
{"t":"start","id":2,"outputDir":"/…/rec","source":{"kind":"display","displayId":1,"excludePids":[123]},"region":{"x":0,"y":0,"width":800,"height":600},"fps":60,"audio":{"system":true,"mic":"default"}}
{"t":"start","id":2,"outputDir":"/…/rec","source":{"kind":"window","windowId":99},"fps":30,"audio":{"system":false}}
```

Outbound: `pong {version,caps}`, `ready`, `started {firstFramePtsNs,startHostTimeNs,width,height,scaleFactor}`,
`stats {fps,droppedFrames,fileBytes}` every 1s, `interrupted {reason,message}`,
`stopped {durationMs,paths,pausedRanges,discarded}`, `error {code,message}`.
Replies echo the command `id`. The process exits after `stopped` (or a failed `start`).
Closing stdin while recording finalizes the files (`interrupted` reason `parentGone`).

**reelform-cursor-monitor** — inbound `ping`, `start`, `pause`, `resume`, `stop`, `exportCursors {dir}`.
Outbound `pong`, `ready`, `started {hostTimeNs,sampleHz,clickSource,keys}`,
`move {tNs,x,y,cursor}` (emitted only when position or cursor type changes),
`click {tNs,x,y,button,phase}`, `key {tNs,keyCode,modifiers}`, `scroll {tNs,dx,dy}`,
`cursorsExported {dir,files}`, `stopped {samples}`, `error`.
Coordinates are CoreGraphics global points (origin top-left of the primary
display — the same space as `SCDisplay.frame`); main normalizes them against the
capture bounds. Key events carry virtual key codes + modifier mask
(`shift 1, control 2, option 4, command 8, fn 16, capsLock 32`) — never characters.

**Clock.** Every `*Ns` value is host time (`mach_absolute_time` in ns ≡
`CMClockGetHostTimeClock`). Main rebases telemetry with
`tMs = (tNs - firstFramePtsNs) / 1e6` (§5.6).

**Pause.** One `PauseTracker` is shared by all writers: samples stamped inside a
paused range are dropped, later samples are shifted back by the paused
duration, so the files are continuous and stay aligned. Paused ranges (host ns)
are reported in `stopped.pausedRanges`.

**CLI one-shots** (not part of the session):

```sh
reelform-sck --permissions            # {"t":"permissions","screen":"granted","microphone":"notDetermined"}
reelform-sck --request-permissions    # prompts, then prints the same line
reelform-cursor-monitor --permissions # {"t":"permissions","inputMonitoring":"denied","accessibility":"granted"}
reelform-cursor-monitor --export-cursors <dir>   # <kind>@2x.png + pack.json, prints cursorsExported
```

## Capture details

- `SCContentFilter`: display (excluding apps by PID — Reelform HUD/bubble), or a single window.
- `SCStreamConfiguration`: BGRA, `showsCursor=false`, `capturesAudio` = `audio.system`,
  `excludesCurrentProcessAudio=true`, `minimumFrameInterval=1/fps`, `queueDepth=8`,
  `scalesToFit=false`, width/height = source pixel size (points × `pointPixelScale`, floored to even),
  `sourceRect` = region.
- `AVAssetWriter`: H.264 High AutoLevel, hardware encoder preferred, bitrate table
  (1080p 18 Mbps, 1440p 28, 4K 45, ×1.7 at 60fps; tier by pixel area), keyframe every 2s,
  no B-frames, `expectsMediaDataInRealTime`, BT.709 color tags.
- Crash safety: `movieFragmentInterval = 2s` on every writer; `finishWriting` rewrites the moov.
- Only `SCFrameStatus.complete` frames are appended; SCK sends none while the screen is
  static, so `screen.mp4` is variable-frame-rate.
- Audio buffers stamped before the first video frame are dropped so all files start at
  `firstFramePtsNs`. Mic buffers are converted from the capture session's
  `synchronizationClock` to the host clock.
- Mic is AAC mono 128 kbps (spec fixes only system audio at 192k).

## Signing & entitlements

Helpers ship inside the app bundle (`Contents/Resources/bin/` via `asarUnpack` /
`extraResources`) and are spawned by main — never through a shell.

1. Sign each helper with the Developer ID Application identity and hardened runtime,
   *before* signing the app bundle:

   ```sh
   codesign --force --options runtime --timestamp \
     --entitlements helper.entitlements.plist \
     --sign "Developer ID Application: …" reelform-sck reelform-cursor-monitor
   ```

2. `helper.entitlements.plist` (hardened runtime, not sandboxed — no MAS in 1.0):

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0"><dict>
     <key>com.apple.security.device.audio-input</key><true/>
     <key>com.apple.security.device.camera</key><true/>
   </dict></plist>
   ```

3. The app's `Info.plist` must carry `NSMicrophoneUsageDescription` and
   `NSCameraUsageDescription`. TCC attributes a child process's screen-recording, mic
   and input-monitoring access to the *responsible* app (Reelform.app), so the user
   grants Reelform once; unsigned/dev builds are attributed to the terminal instead.
4. Notarize the app (`notarytool submit --wait`) and staple; the helpers are covered
   by the app's notarization ticket.

### Permissions

| Capability | API | Without it |
|---|---|---|
| Screen recording | `CGPreflightScreenCaptureAccess` / `CGRequestScreenCaptureAccess` | `start` → `error permissionDenied`, helper exits |
| Microphone | `AVCaptureDevice.requestAccess(for: .audio)` | `start` with `audio.mic` → `error permissionDenied` |
| Input Monitoring | listen-only `CGEventTap` (`CGPreflightListenEventAccess`) | falls back to `NSEvent` global monitor: clicks + scroll, **no keys** (`started.clickSource = "globalMonitor"`, `keys: false`) |

The spec text names Accessibility for the event tap; on macOS 10.15+ a
*listen-only* tap is gated by Input Monitoring. Both statuses are reported by
`--permissions` so onboarding can explain whichever is missing.

## Known limits / not verified in CI yet

- Real capture paths (SCStream, writers, mic, event tap) need a GUI session with
  permissions granted; they are covered by the §14.1 native helper tests
  (ping, 3s capture, pause/resume continuity, simulated interruption) on the macOS runner.
- `NSCursor.currentSystem` classification falls back to size + hotspot when the image bytes
  differ (e.g. accessibility cursor size); ambiguous geometry reports `arrow`.
- Diagonal resize cursors (`resize-nesw`/`resize-nwse`) are detected/exported only on
  macOS 15+ (`NSCursor.frameResize`); macOS 14 has no public diagonal cursors.
