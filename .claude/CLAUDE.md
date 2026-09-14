# Reelform — Project Guide for Claude

Desktop screen recorder + demo-video editor. macOS, Windows, Linux.
Make screen recordings look designed: auto-zoom, backgrounds, captions, annotations.

## Stack

- **Electron + React + PixiJS** — single codebase, 3 OSes.
- **WebCodecs first, ffmpeg second** — GPU render in renderer; ffmpeg for mux/transcode fallbacks.
- **Native helpers** for capture parts Chromium can't do.
- **Local-first, no accounts** in 1.0. On-device Whisper for captions.

## Reference material

Read `.claude/refrence/` before non-trivial work:
- `01_CLAUDE_DESIGN_UI_GUIDE.md` — design system, every screen + state.
- `02_PLAN.md` — product plan, decisions log, why-this-why-now.
- `03_ENGINEERING_SPEC.md` — engineering detail.

## Also see

- `.claude/rules.md` — coding rules and conventions.
- `.claude/Architecture.md` — system architecture.
- `NOTICE.md` — third-party attributions (OpenScreen, MIT).

## Reference bar

Screen Studio, Cap, OpenScreen (https://github.com/siddharthvaddem/openscreen), Linear, Arc.
Calm, dense, professional, dark-first.
