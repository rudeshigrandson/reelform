# Getting started

Reelform turns a screen recording into a polished demo video: it zooms in
where you click, puts your recording on a background, smooths the cursor and
adds captions. Everything happens on your computer.

## 1. Install

- **macOS 14 or later:** open the `.dmg` and drag Reelform to Applications.
- **Windows 10 or 11:** run the installer.
- **Linux:** make the `.AppImage` executable (`chmod +x Reelform-*.AppImage`)
  and run it. System audio needs PipeWire.

Updates download in the background. When one is ready, choose
**Restart to update** in the launcher banner or in Settings › Updates.

## 2. First run

Setup walks you through three steps:

1. **Welcome.**
2. **Permissions.** Grant **Screen Recording**; it's required. Microphone,
   Camera and Accessibility are optional, and Reelform works without them.
   On macOS you may need to quit and reopen Reelform after granting Screen
   Recording. If something doesn't stick, see
   [Troubleshooting permissions](troubleshooting-permissions.md).
3. **Defaults.** Choose where recordings are saved, the frame rate, and whether
   the editor opens after you record.

You can run setup again any time from **Settings › General › Run setup again…**.

## 3. Record

1. Click **New recording** in the launcher, or press **⇧⌘R** (macOS) or
   **Ctrl+Shift+R** (Windows/Linux).
2. Pick **Display**, **Window** or **Region**, and turn the microphone,
   system audio and camera on or off.
3. Press **Record**. A countdown runs (3 seconds by default; change it in
   Settings › Recording).
4. Pause and resume with **⇧⌘P** / **Ctrl+Shift+P**. Stop from the HUD, the
   menu bar or tray icon, or the start/stop shortcut.

Tips:

- The recording controls, and the webcam bubble while you record, never
  appear in the video.
- Plain typing isn't kept after the recording ends; only shortcuts (like ⌘S)
  stay available as keystroke badges. See [Privacy](../PRIVACY.md).

## 4. Edit

When the recording finishes, the editor opens with **auto-zoom suggestions**
based on where you clicked. Review them and keep the ones you like.

- **Frame:** background, padding, rounded corners, shadow, aspect ratio.
- **Cursor:** size, smoothing, click effects and sounds.
- **Zoom:** add, move or remove zooms on the timeline.
- **Webcam, Audio, Captions, Annotations, Effects:** tabs in the inspector.
- **Timeline:** press **S** to split at the playhead, **[** and **]** to trim, and
  **Space** to play.

Projects autosave. See every shortcut in [Shortcuts](shortcuts.md), or press
**?** in the editor.

## 5. Captions

Open the **Captions** tab and choose a model: **Fast** (about 32 MB, English),
**Balanced** or **Accurate**. The model downloads once, and transcription then
runs on your computer. Edit the text in the list, then burn captions into the
video or export `.srt`/`.vtt` files beside it.

## 6. Export

Click **Export** (**⌘E** / **Ctrl+E**) and pick **MP4**, **WebM** or **GIF**,
along with the resolution and frame rate. Reelform uses your GPU when it can.
When the export finishes, **Reveal** shows the file.

## Where things are

- Recordings and projects: the folder in Settings › General (default
  `~/Movies/Reelform` on macOS).
- Logs: Settings › Advanced › Open logs folder.
- Help with a problem: Settings › About › Copy diagnostics, then paste it into
  a GitHub issue. Paths and your user name are removed automatically.

More answers are in the [FAQ](faq.md).
