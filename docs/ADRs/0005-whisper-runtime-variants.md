# ADR 0005: whisper.cpp ships as a CPU build everywhere, Metal on macOS, Vulkan optional

- **Status:** Accepted
- **Source:** ENGINEERING_SPEC §16 question 4; §9.6

## Context

A Vulkan build of `whisper-cli` for Windows adds size and has driver-dependent
failure modes. CUDA builds are far larger still.

## Decision

- **macOS:** Metal build with an embedded shader library (one binary per arch).
- **Windows and Linux:** static CPU build with OpenMP, always shipped. CUDA is off.
- **Vulkan:** supported but optional. `scripts/build-whisper-runtime.mjs --vulkan`
  produces `whisper-cli-vulkan[.exe]`, and `electron/captions/runtime.ts`
  prefers it when it's present and falls back to the CPU binary. The release
  workflow currently builds CPU-only (no `--vulkan` flag in `build.yml`) to
  keep installers small.

## Consequences

- Captions work on every supported machine. Windows and Linux transcription is
  slower than on GPU, which the Fast model tier (`tiny.en`) offsets.
- Turning on Vulkan for a release is a one-flag CI change, with no code change.
