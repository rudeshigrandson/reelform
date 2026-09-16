# ADR 0004: Export codec options come from a runtime encoder probe

- **Status:** Accepted
- **Source:** ENGINEERING_SPEC §16 question 3; §10.1

## Context

HEVC and AV1 `VideoEncoder` support depends on the GPU, the driver and the OS,
so a fixed support matrix would be wrong on some machines.

## Decision

- H.264 is always offered (hardware when available, otherwise software).
- HEVC and AV1 are offered only when the probe on the current machine
  (`VideoEncoder.isConfigSupported` with the export's resolution, frame rate and
  bitrate) succeeds. `src/export/route.ts` carries the probed `hevc` and `av1`
  flags into route selection, and `src/export/engine/encoderConfig.ts` picks
  profile and level from the spec tables (HEVC Table A.8, AV1 Annex A).
- VP9/Opus WebM and GIF don't depend on the probe.

## Consequences

- The Export dialog never offers a codec that would fail mid-export.
- Settings › Advanced lists the encoders and says they're checked when you
  export, until the probe results are shown there too.
