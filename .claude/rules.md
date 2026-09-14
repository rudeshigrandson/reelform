# Rules

Non-negotiable working rules for anyone (human or agent) building in this repo.

## Harness / testing (non-negotiable)

### 1. New feature → integration test in the harness, and run it

Every new feature you create **must** ship with an appropriate integration test
added to the harness. Write the test, then **run it** — a feature without a passing
harness test is not complete.

### 2. Every change is verified by a successful harness run

For **any** feature change or newly added feature, success is determined **only** by
the harness passing. "Done" means the harness ran and went green — not "it compiles"
or "it looks right." No change is accepted on inspection alone.

### 3. Add edge cases for components the change could break

For each new or changed feature, figure out which **existing, error-prone components**
the change could affect, and add edge-case harness runs that exercise them. Guard the
blast radius, not just the happy path of the new code.

### 4. The harness is a self-verification engine

Treat the harness as a **self-verification engine**. Add new harness cases whenever
they're needed to prove a change is correct — **autonomously, without disturbing the
user**. Growing coverage to verify your own work is expected, not something to ask
permission for.

### 5. Re-architect the tests periodically to kill duplication

From time to time, **re-architect** the test suite to remove duplication — shared
fixtures, stubs, and helpers over copy-paste. Keep the harness lean so it stays fast
and trustworthy as coverage grows.

## General

- Read `.claude/refrence/` specs before implementing a feature. Don't invent features not listed.
- Match surrounding code style — naming, comment density, idiom.
- Local-first, no accounts in 1.0. No cloud calls without explicit reason.

## Code

- TypeScript strict. No `any` unless justified with a comment.
- Renderer (React/PixiJS) does GPU work; main process owns capture + fs + native helpers.
- IPC: typed channels only. No raw string channel names scattered in code.
- WebCodecs is the primary encode path. ffmpeg is fallback/mux only — don't reach for it first.

## UI

- Dark-first. Follow tokens in `01_CLAUDE_DESIGN_UI_GUIDE.md` — do not hardcode colors/spacing.
- Every screen must handle its listed states (loading, empty, error, permission-denied).

## Licensing

- Any copied third-party code/assets → record in `NOTICE.md` with its license.
- OpenScreen is MIT; keep its copyright notice for any incorporated portions.

## Git

- **Solo committer: only Mishal Udeshi commits.** Claude is NOT a co-committer.
  Do NOT add `Co-Authored-By: Claude` or any co-author trailer to commits.
- **Commit small features frequently** — each working increment gets its own commit
  so nothing is lost. Small, atomic commits over big batched ones.
- **New features live on a branch.** Never commit new-feature work straight to
  `main`. Branch off `main`, build there, commit small increments as you go.
- **Merge to production (`main`) only after everything is tested and works
  perfectly.** No merging half-done or unverified work.
- Commit/push only when asked.
