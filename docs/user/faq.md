# FAQ

### Is Reelform free? Do I need an account?

There's no account. Everything runs on your computer and nothing is uploaded.

### Does Reelform upload my recordings or send anything anywhere?

No. Recordings, projects and captions stay on your device. The only network
use is the update check (you can turn it off in Settings › General) and caption
model downloads you start yourself. Details are in the [privacy page](../PRIVACY.md).

### Does it record what I type?

While you record, Reelform notes which **keys** are pressed so it can show
keystroke badges. Plain typing is thrown away when the recording ends; only
shortcuts like ⌘S remain. If you want badges for typed text too, turn on
**Settings › Recording › Record typed text badges** (off by default). That data
never leaves your device.

### My recording is black / has no sound.

This is almost always a permission. See
[Troubleshooting permissions](troubleshooting-permissions.md). On macOS, quit
and reopen Reelform after granting Screen Recording.

### Why are some options under Settings › Recording greyed out?

"Hide desktop icons", "Do Not Disturb while recording" and "Show clicks during
capture" need operating-system helpers that aren't available yet, so they're
marked "Not available yet". Click effects can still be added in the editor's
Cursor tab.

### Can I change the keyboard shortcuts?

Yes. Go to **Settings › Shortcuts**, click a shortcut and press the new keys.
Esc cancels. If another app already owns a global shortcut, that row shows a
warning. See [Shortcuts](shortcuts.md).

### Which export format should I use?

- **MP4 (H.264):** plays everywhere; best for sharing and uploads.
- **WebM:** smaller files; supports transparency when the background is set
  to none.
- **GIF:** for docs and READMEs; keep it short and small.

HEVC and AV1 appear only when your computer can encode them.

### How accurate are captions? Which languages?

Choose a model in the Captions tab: **Fast** (English only, quickest),
**Balanced**, or **Accurate** (slowest, best quality). Balanced and Accurate
understand many languages. You can edit any caption afterwards.

### Where are my projects saved?

In the folder set in **Settings › General › Save recordings to**. Each project
is a folder (a single package on macOS) with its media and a project file.
Auto-prune can remove old raw recordings after the number of days you choose.

### How do I make the interface calmer or denser?

**Settings › Appearance:** choose the theme, the accent color and **UI density**
(Compact fits more on screen). Turn on **Reduce motion** to switch off
animations; Reelform also follows your OS reduce-motion setting.

### How do I get beta versions?

**Settings › Updates › Channel › Beta.** Beta gets features about a week early.
Switching back to Stable never downgrades you; you'll move to the next stable
release.

### Where are the licenses for the software Reelform includes?

**Settings › About › Licenses**, or `NOTICE.md` and `THIRD_PARTY_LICENSES.txt`
in the app's resources folder. The bundled FFmpeg is GPLv3; its source offer is
in `ffmpeg/<platform>/SOURCE.txt` beside it.

### How do I report a bug?

**Settings › About › Copy diagnostics**, then open an issue at
https://github.com/rudeshigrandson/reelform/issues and paste the report. Paths
and your user name are removed automatically.
