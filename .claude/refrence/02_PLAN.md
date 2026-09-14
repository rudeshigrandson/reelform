# Reelform — Product & Delivery Plan

Working name: **Reelform** (rename freely; everything else stays).
Owner: Mishal. Status: v0 — planning. Date: 2026-09-14.

Companion docs: `01_CLAUDE_DESIGN_UI_GUIDE.md` (every screen), `03_ENGINEERING_SPEC.md` (how to build it). This document is the *what, why, when, who*.

---

## 1. One-liner

**Record your screen, get a designed demo video — automatically.** A desktop app (macOS · Windows · Linux) that records a display/window/region with mic, system audio and webcam, then opens an editor that adds smooth auto-zooms, a polished cursor, a styled frame, webcam bubble, captions and annotations, and exports MP4 / GIF / WebM. Local-first, no upload, no account required.

## 2. Why this, why now

- Screen Studio proved people pay a premium for "make my screen recording look designed" — and it is macOS-only.
- Cap and OpenScreen proved an open cross-platform version is buildable by a small team on Electron/Tauri with native capture helpers.
- Product marketers, indie hackers, devrel, support teams, and course creators all produce demo videos weekly and hate opening a real NLE.
- On-device Whisper makes free, private auto-captions viable — table stakes in 2026 that most competitors still gate behind cloud.

**Differentiation we commit to (not "we'll see"):**
1. Cross-platform parity for the core loop (record → auto-zoom → export) on macOS and Windows at launch; Linux at 1.1.
2. **Best-in-class auto-zoom** — click/typing/dwell heuristics + follow-cam, with a one-click "Review suggestions" flow that never feels random.
3. **On-device captions** with karaoke styling and .srt export, free.
4. **Keystroke badges** auto-detected from key telemetry (unique, huge for dev demos).
5. **Fast exports** via hardware encoders; a 1-minute 1080p60 export in < 30s on an M-series Mac or a modern NVIDIA/Intel laptop.
6. Extensions API (v1.2+) so a marketplace can grow frames, wallpapers, cursor packs, sounds.

## 3. Target users & jobs-to-be-done

| Persona | JTBD | Success looks like |
|---|---|---|
| Indie founder / PM | "Ship a 45s product update video for Twitter/LinkedIn/Product Hunt today." | Record → 2 minutes of tweaks → export vertical + landscape. |
| Developer / DevRel | "Show a CLI/IDE flow with visible shortcuts and zooms on the terminal." | Keystroke badges, terminal-friendly zoom, GIF for README. |
| Support / CS | "Answer a ticket with a 20s how-to." | Region record, no editing, one-click export, copy to clipboard. |
| Course creator | "Record a 10-min lesson with webcam, captions and clean cursor." | Long recording stability, captions, speed-up idle, chapters via annotations. |

Non-goals for v1: multi-track video compositing, live streaming, cloud sharing links, team libraries, mobile apps.

## 4. Scope — the complete v1.0 feature set (shippable, not MVP)

Everything below is **in** for 1.0 unless tagged.

**Recording**
- Display / window / region capture; multi-monitor aware; HiDPI correct.
- Native capture: ScreenCaptureKit (macOS 14+), Windows Graphics Capture + WASAPI + Media Foundation (Win10 19041+); Electron fallback everywhere (Linux primary path).
- Mic (device select, level meter, gain), system audio, webcam (device select, preview bubble, separate track).
- Countdown, pause/resume, hidden-HUD mode, global hotkeys, tray/menu-bar control.
- Cursor & click & keystroke telemetry recorded alongside video (per-frame timestamps).
- OS cursor hidden during capture where supported; rendered cursor in post.
- Crash-safe: recording is written progressively; recovery on relaunch.

**Editor**
- Preview at 60fps on GPU (WebGPU → WebGL fallback), pixel-accurate to export.
- Timeline: video clips, trim, split, ripple delete, zoom regions, speed regions, annotations, captions, webcam enable regions, extra audio, mic/system lanes; snapping, marquee, multi-select, undo/redo (100 steps).
- Auto-zoom suggestions with sensitivity; manual zoom with focus, level, easing, follow-cursor.
- Cursor: styles (mac/win/dot/custom), size, smoothing, motion blur, click effects & sounds, sway, hide-idle, loop mode.
- Frame: wallpapers (bundled 40+), color, gradient, custom image, blur, padding, radius/squircle, shadow, border, aspect presets incl. vertical, inset scale, presets.
- Webcam bubble: shape, size, 3×3 + custom position, margin, mirror, border, shadow, zoom-reactive, crop/reframe, audio auto-sync.
- Audio: per-track volume/mute/solo, noise reduction (mic), normalize, fades, extra music with ducking, click sounds.
- Captions: on-device Whisper (3 model sizes), language auto-detect, editable list, styles incl. karaoke word-highlight, custom fonts, burn-in or .srt/.vtt sidecar.
- Annotations: text, arrow, line, rect, ellipse, highlight, blur/pixelate, image/logo, emoji, number badge, keystroke badge (auto-detected), in/out animations, follow-zoom.
- Effects: speed regions with pitch-keep, remove-silence, auto speed-up idle, transitions, intro/outro title cards, color adjust, vignette/grain, subtle 3D tilt.
- Crop source frame.
- Projects: `.reelform` file (JSON + relative media refs), autosave, recent list, project browser, relink media, trim source to used range.

**Export**
- MP4 (H.264; HEVC/AV1 where hardware supports), WebM (VP9/AV1), GIF (palette/dither controls, size presets).
- Resolution/fps/quality/codec/range controls, estimated size, hardware acceleration with automatic software fallback, background export with progress toast, reveal/copy/share on done.
- Caption burn-in or sidecar.

**App**
- Onboarding & permissions flow; settings (general, recording, editor, shortcuts, appearance, updates, extensions, advanced); auto-update (Stable/Beta); i18n scaffold (EN at launch; strings externalized); diagnostics bundle; crash reporting (opt-in); anonymous usage stats (opt-in, off by default).
- Signed & notarized macOS DMG (universal), signed Windows NSIS installer, Linux AppImage + AUR (1.1).

**Tagged for after 1.0**
- 1.1: Linux native audio via PipeWire helper, AUR/Flatpak, chapters export, batch export presets.
- 1.2: Extensions API + marketplace, cursor/frame packs, share-to-YouTube/Slack.
- 1.3: Multi-clip projects (import multiple recordings), B-roll images, AI "summarize into 30s cut".

## 5. Success metrics

- **Activation:** 60% of installs complete a first export within 24h.
- **Core loop time:** median record-stop → export-click < 4 minutes for a ≤ 2-min video.
- **Quality:** crash-free sessions ≥ 99.5%; export failure rate < 1%; A/V drift < 20ms over 10 minutes.
- **Performance budgets:** preview ≥ 55fps at 1080p on M1 / RTX 3050 / Intel Iris Xe; 1-min 1080p60 export < 30s (HW) / < 90s (SW); app cold start < 1.5s; idle memory < 400MB in editor.
- **Retention:** 30% of activated users export again within 14 days.

## 6. Team & roles

Minimum viable team for the timeline in §7 (5 people + Mishal). Roles can be merged if people are strong across areas.

| Role | Count | Owns |
|---|---|---|
| Tech lead / architect (Mishal) | 1 | Architecture, code review, macOS native helper (Swift), release engineering |
| Frontend/editor engineer (React + PixiJS) | 2 | Editor UI, timeline, inspector, preview renderer, annotations, captions UI |
| Media pipeline engineer (TS + WebCodecs + ffmpeg) | 1 | Decode/encode/mux, export routes, audio processing, GIF, color correctness |
| Windows native engineer (C++/WinRT) | 1 (contract OK) | WGC/WASAPI/MF helper, cursor monitor, HW encoder probing, MSIX/NSIS signing |
| Designer | 1 (part-time) | Runs the Claude Design guide, produces assets, wallpapers, cursor packs, marketing |
| QA / release (part-time from week 10) | 0.5 | Test matrix, device lab, release checklists |

Ways of working: trunk-based, PRs < 400 lines, CI green required, weekly demo build to a #dogfood channel, every engineer records their own demo videos with the app every week (dogfooding is mandatory).

## 7. Timeline & milestones (24 weeks to 1.0)

Assumes team above from week 1. Each milestone ends with an internal build and a written go/no-go.

**M0 — Foundations (weeks 1–2)**
Repo, Electron+Vite+React+TS scaffold, design tokens & component library from the Claude Design output, IPC framework with typed contracts, project file schema v1, CI for 3 OSes producing unsigned builds, logging/diagnostics, settings store. Exit: an app that launches on all 3 OSes, shows the launcher, saves settings.

**M1 — Record (weeks 3–6)**
Electron fallback capture (all OSes) with mic/system/webcam, HUD, source picker, region selector, countdown, pause/resume, telemetry (uiohook), crash-safe writing, post-record dialog. Parallel: Swift ScreenCaptureKit helper (mac), WGC helper (win). Exit: reliable 10-minute 1080p60 recordings on all platforms; native helpers produce playable MP4 with synced audio.

**M2 — Editor core (weeks 5–10)**
Pixi preview with frame/background/cursor/zoom transform, timeline with clips/trim/split/zoom regions, inspector Frame + Cursor + Zoom tabs, undo/redo, autosave, project browser. Auto-zoom v1. Exit: open a recording, accept suggestions, tweak, scrub at 60fps.

**M3 — Export (weeks 9–13)**
WebCodecs render → mediabunny MP4, hardware encoder detection, software fallback, audio mix/encode, GIF pipeline, WebM, progress/cancel, native static-layout fast path (ffmpeg). Pixel parity tests preview vs export. Exit: exports match preview; performance budgets hit on reference machines.

**M4 — Full feature set (weeks 12–18)**
Webcam bubble, audio panel (NR, normalize, ducking), captions (whisper.cpp runtime + UI + styles + sidecars), annotations (all types incl. keystroke badges), effects (speed, remove-silence, transitions, intro/outro, color), crop, settings pages, shortcuts editor, onboarding. Exit: every item in §4 works end-to-end; feature freeze.

**M5 — Hardening & polish (weeks 18–22)**
Test matrix (device lab: M1/M2/M3 Macs incl. Intel, Win 10/11 with NVIDIA/AMD/Intel, Ubuntu/Fedora), memory/leak passes, long-recording soak tests (60 min), a11y pass, light theme pass, i18n extraction, crash reporting, update channel, code signing + notarization, installers, docs & website. Private beta (50 users) from week 19.

**M6 — Launch (weeks 22–24)**
Release candidate, public beta on Beta channel, launch content (the app records its own launch video), Product Hunt / HN / Twitter launch, AUR (1.1 prep). Exit: 1.0 tagged, auto-update live.

Post-launch cadence: patch releases weekly for 6 weeks, then bi-weekly minor releases per §4 tags.

## 8. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Native capture helpers (Swift/C++) slip | Blocks mac/win quality | Electron fallback path is first-class from M1; helpers are additive, never on the critical path for editor/export work |
| WebCodecs quirks (color space, HEVC availability, Linux support) | Wrong colors, failed exports | Golden-frame tests per platform; ffmpeg software route always available; BT.709 tagging enforced in muxer |
| A/V sync drift on long recordings | Unusable footage | Timestamp-based muxing (never frame-count), drift tests in CI with synthetic 30-min sources |
| Electron app size/memory perception | Reviews | Ship < 180MB installer; lazy-load whisper runtime and wallpapers; memory budgets in CI |
| Apple notarization / Windows SmartScreen | Users can't open the app | Set up Apple Developer + EV code-signing cert in week 1; sign every CI build from M1 |
| Auto-zoom feels random | Core promise fails | Heuristic tuned on a labelled corpus of 50 real recordings; "Review suggestions" UX; sensitivity slider; never auto-apply silently |
| Scope creep from "complete app" | Timeline | §4 is the contract; anything new goes to 1.x tags; feature freeze at week 18 is hard |
| Single Windows native engineer | Bus factor | Document the helper protocol; keep helper < 3k LOC; CI builds it on windows-latest so anyone can iterate |

## 9. Pricing & distribution (decide by M4; default below)

- **Free**: everything, with a small animated "Made with Reelform" outro card on exports (removable in Pro). No watermark over content.
- **Pro (one-time, $59, 1 year of updates)**: no outro, export presets, custom cursor/frame packs, priority support. License key validated offline (Ed25519-signed), no account.
- Open-source core? Default **source-available (BSL → Apache after 3 years)** to allow extension ecosystem and trust, while protecting against cheap re-skins. Revisit if community growth is the priority.
- Distribution: direct download (site), Homebrew cask, winget, AUR, Flatpak (1.1). Mac App Store not at 1.0 (ScreenCaptureKit helper + sandbox friction).

## 10. Launch checklist

- [ ] Signed/notarized builds on all channels; auto-update tested Stable ← Beta.
- [ ] Website with 60s demo video recorded in the app; docs (Getting started, Shortcuts, Troubleshooting permissions, FAQ).
- [ ] Privacy page: local-first, what telemetry (opt-in) contains.
- [ ] Support inbox + GitHub Discussions (or Discord).
- [ ] Crash reporting dashboard alerting.
- [ ] Beta feedback triaged; zero P0/P1 open.
- [ ] Launch posts drafted; 5 example videos exported from real apps.

## 11. Decisions log (made with full autonomy — change if you disagree)

1. **Electron + React + PixiJS**, not native SwiftUI or Tauri. Reason: single codebase for 3 OSes, WebCodecs/WebGPU maturity in Chromium, a proven reference architecture (OpenScreen/Cap), hiring pool. Native helpers handle the parts Chromium can't.
2. **WebCodecs first, ffmpeg second.** Rendering happens in the renderer on GPU; ffmpeg is used for muxing/transcoding fallbacks and simple static-layout fast paths, not as the primary encoder.
3. **Local-first, no accounts** in 1.0. Sharing links are a 1.x feature and never required.
4. **Project file = JSON + relative media**, human-readable, versioned, forward-migratable.
5. **Zustand + immer** for editor state with a command-pattern history, not Redux.
6. **Design system built from the Claude Design output** into shadcn-style components; no third-party component kit beyond Radix primitives.
7. **Telemetry opt-in and off by default**; crash reports opt-in at first crash.
