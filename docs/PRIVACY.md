# Privacy

Reelform is local-first. There's no account, and your recordings, projects,
captions and settings stay on your computer. This page lists everything
Reelform stores and every time it talks to the network.

_Applies to Reelform 1.0 and later. Changes to this page are tracked in the
repository history._

## What stays on your device

- **Recordings and projects.** Screen, microphone, system-audio and webcam media,
  plus the project file, are saved in your recordings folder (Settings ›
  General). They may contain anything that was on your screen, so treat them as
  sensitive. Reelform never uploads them. Deleting a project moves it to the
  trash, and Settings › Advanced › Clear cache removes cached data.
- **Recording telemetry.** While a recording runs, Reelform saves cursor
  positions, clicks and keyboard **key codes** with the project. Auto-zoom,
  the cursor effects and keystroke badges use this data.
  - Keys are captured **only while recording**, never at any other time.
  - Reelform stores **codes, not characters**.
  - Plain typing (letters without a modifier such as ⌘ or Ctrl) is
    **discarded when the recording finishes**, so only shortcuts like ⌘S remain.
    If you turn on **Settings › Recording › Record typed text badges** (off by
    default), the typed keys are kept so badges can show what you typed. That
    data still stays in the project on your device.
- **Captions.** Transcription runs **on your device** with whisper.cpp. Audio
  is never sent anywhere.
- **Settings and logs.** Settings live in the app's user-data folder. Logs stay
  on disk until you open them (Settings › Advanced › Open logs folder).

## When Reelform uses the network

| What | When | What is sent |
|---|---|---|
| Update check | On launch and every 6 hours, if Settings › General › Check for updates is on, or when you click Check now | A standard request to GitHub Releases for the update feed. No identifiers beyond what any HTTPS request carries (IP address, user agent). |
| Caption model download | Only when you choose to download a model | A standard download from Hugging Face. Files are sha256-verified. |
| Links you click | Privacy policy, Licenses, release notes | Opens your browser. |

Nothing else. Reelform has no ads, no tracking and no background uploads.

## Usage stats and crash reports

- **Usage stats are opt-in and off by default.** In 1.0 the setting exists,
  but Reelform collects nothing, so turning it on has no effect. If a usage
  pipeline is ever added, it will stay opt-in, it will be described here before
  it ships, and it will never include recordings, frames, file names, file paths,
  typed text or key codes.
- **Crash reports are opt-in.** Reelform 1.0 sends no crash reports. If crash
  reporting is added, Reelform will ask the first time a crash happens, and the
  report will have file paths and your user name scrubbed.

## Diagnostics you share

Settings › About › **Copy diagnostics** puts a report on your clipboard for you
to paste into a bug report. Nothing is sent automatically. Before it's copied,
Reelform **scrubs paths**: your home folder, your OS user name and every absolute
file path are replaced (the file extension is kept, for debugging). Settings that
hold paths, such as the recordings folder, are removed entirely. The report
contains the app, OS and GPU versions, settings and recent log lines.

## Permissions

Reelform asks for:

- **Screen Recording**, to capture your screen;
- **Microphone** and **Camera**, for narration and the webcam bubble;
- **Accessibility** or **Input Monitoring** (macOS), to follow the cursor and
  clicks and record keystroke badges while recording.

Each permission is used only for that purpose.
See [Troubleshooting permissions](user/troubleshooting-permissions.md).

## Contact

Questions or concerns: open an issue at
https://github.com/rudeshigrandson/reelform/issues.
