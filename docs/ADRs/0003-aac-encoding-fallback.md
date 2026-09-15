# ADR 0003: AAC via WebCodecs, with a PCM → ffmpeg AAC finalize fallback

- **Status:** Accepted
- **Source:** ENGINEERING_SPEC §16 question 2; §10.5

## Context

MP4 exports need AAC-LC audio. `AudioEncoder` support for `mp4a.40.2` is
missing from some Chromium builds, notably on Linux, because of codec
licensing.

## Decision

`src/export/engine/audio.ts` probes the encoder at export time:

- **MP4:** AAC-LC 192 kb/s through WebCodecs when `AudioEncoder.isConfigSupported`
  says yes.
- **WebM:** Opus through WebCodecs.
- **Otherwise:** the mixed audio is written as 16-bit PCM WAV, and the export
  is flagged for an **ffmpeg AAC finalize step** in main, which muxes AAC into
  the final MP4.

## Consequences

- MP4 export works on every OS, with a finalize step costing a few seconds on
  platforms without WebCodecs AAC.
- The bundled ffmpeg (ADR 0001) is required for that path, so its absence is
  reported as a clear export error rather than a silent track without audio.
