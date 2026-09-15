# ADR 0006: "Center on face" is an optional, injected detector

- **Status:** Accepted
- **Source:** ENGINEERING_SPEC §16 question 5; §9.4

## Context

"Center on face" in the webcam crop needs a face detector. MediaPipe Tasks
Vision (about 3 MB of wasm) is the planned choice, and the question was whether
its size is worth it for 1.0.

## Decision

Keep the feature, but behind a port: the crop modal
(`src/editor/inspector/webcam/CropModal.tsx`) takes an optional
`onCenterOnFace()` that resolves to a normalized face center, or `null`. The
detector samples frames once in the editor. If detection is unavailable, fails
or finds no face, the crop is centered. The wasm loads lazily the first time
someone uses the button.

## Consequences

- No startup or bundle cost for people who never use the button.
- The detector can be swapped or dropped without touching the crop UI.
- Its license must be recorded in NOTICE.md and `THIRD_PARTY_LICENSES.txt`
  when it ships (MediaPipe is Apache-2.0).
