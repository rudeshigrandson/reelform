# Troubleshooting permissions

Reelform needs your permission to see the screen and, optionally, to use the
microphone and camera and to follow the cursor. If a recording is black, silent,
or has no cursor or zoom data, a permission is usually the reason.

To check the current status, open **Settings › General › Run setup again…**. The
permissions step shows each permission live and has buttons that open the right
system settings page.

## macOS

Permissions are in **System Settings › Privacy & Security**.

| Permission | Pane | Needed for | If it's missing |
|---|---|---|---|
| Screen Recording | Screen & System Audio Recording | Recording at all (required) | Black video, or recording won't start |
| Microphone | Microphone | Narration | Silent mic track |
| Camera | Camera | Webcam bubble | No webcam option |
| Accessibility | Accessibility | Following the cursor and clicks for auto-zoom | No zoom suggestions or click effects |
| Input Monitoring | Input Monitoring | Keystroke badges | No keystroke badges |

**Screen Recording is granted but recordings are still black**

1. Quit Reelform completely (⌘Q). macOS applies Screen Recording only after a
   restart of the app.
2. Reopen Reelform.
3. If it's still black, turn Reelform **off and on** in the Screen Recording
   list, or remove it with **–**, then reopen Reelform and grant again.
4. After an update, macOS sometimes keeps a stale entry. Remove Reelform from the
   list and grant again.

**Reelform isn't in the list**

Start a recording once; macOS adds the app when it first asks. You can also
click **+** and choose Reelform from Applications.

**"Screen Recording permission was revoked" banner**

You or a management profile turned the permission off. Grant it again and restart
Reelform. On managed Macs, ask your administrator to allow screen recording for
`app.reelform.desktop`.

**Another app is blocking capture**

Some DRM video players and password managers hide their windows from all screen
recorders. Reelform can't capture those windows.

## Windows

- **Microphone:** Settings › Privacy & security › Microphone. Turn on
  "Microphone access" and "Let desktop apps access your microphone".
- **Camera:** Settings › Privacy & security › Camera. Turn on "Let desktop
  apps access your camera".
- **Screen:** no permission is needed. If a window records black, the app
  may be protected (DRM or some games). Try recording the whole display, or turn
  off hardware acceleration in that app.
- **Global shortcuts don't work:** another app may already own the key.
  Settings › Shortcuts shows a warning on that row. Pick different keys.

## Linux

- **Screen:** on Wayland, the desktop portal asks which screen or window to
  share every time you record. Choose one and press **Share**. If no dialog
  appears, install `xdg-desktop-portal` and the backend for your desktop
  (`xdg-desktop-portal-gnome`, `-kde` or `-wlr`), then log out and back in.
- **System audio:** requires PipeWire (`pipewire-pulse`). With PulseAudio only,
  system audio isn't available.
- **Microphone and camera:** check that your user can access the devices
  (`pavucontrol` for input levels; `/dev/video*` permissions for cameras).
- **Global shortcuts on Wayland:** some compositors don't allow apps to register
  global shortcuts. Use the HUD buttons or the tray icon instead.

## Still stuck?

Open **Settings › About › Copy diagnostics** and paste the report into a new issue
at https://github.com/rudeshigrandson/reelform/issues. The report has your paths and
user name removed.
