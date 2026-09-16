# ADR 0002: Custom timeline engine instead of dnd-timeline

- **Status:** Accepted
- **Source:** ENGINEERING_SPEC §16 question 1; §6.7

## Context

The timeline needs frame-accurate snapping (to the playhead, other item edges
and a 1s grid), marquee selection, alt-drag duplicate, ripple operations and
virtualization for long recordings. `dnd-timeline` was the off-the-shelf
candidate, pending a 2-day spike.

## Decision

Build the timeline in-house in `src/editor/timeline/`:

- `timeScale.ts` for ms ↔ px mapping and zoom around the cursor;
- `snapping.ts` for snap candidates and thresholds;
- `trackOps.ts` for move, resize, split, ripple and duplicate as pure
  functions dispatched as commands;
- `Timeline.tsx` for rendering and gestures.

No `dnd-timeline` dependency.

## Consequences

- Snapping and track operations are pure and unit-tested (`*.test.ts` beside
  each module), including property tests.
- Every operation goes through the command/history layer, so undo is exact.
- We own accessibility and virtualization work that a library might have
  partly provided.
