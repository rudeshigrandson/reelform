# Contributing

Thanks for helping build Reelform. This page covers the workflow. The
non-negotiable rules live in `.claude/rules.md`; this is the human-readable
version.

## Before you start

- Read the specs in `.claude/refrence/` for the area you're touching: the design
  guide for UI, the plan for scope, and the engineering spec for behaviour.
  Don't add features that aren't listed there. New ideas go to a 1.x issue.
- Read [ARCHITECTURE.md](ARCHITECTURE.md) for where code lives.
- Local-first: no network calls without an explicit, documented reason
  (see [PRIVACY.md](PRIVACY.md)).

## Setup

```sh
npm ci
npm run dev
```

Native helpers, whisper-cli and ffmpeg are optional for most work; see the
README.

## Branches and commits

- New work happens on a branch off `main`. Never commit feature work directly
  to `main`.
- Commit small, working increments. Each commit should build and pass tests.
- Merge to `main` through a pull request, and only after everything is tested
  and CI is green.

## Code style

- **TypeScript strict** with `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`. Optional props are typed
  `foo?: T | undefined`. No `any` unless a comment explains why.
- **Biome** formats and lints everything (2-space indent, double quotes,
  100-column lines):

  ```sh
  npm run lint        # check (CI runs `biome ci`)
  npm run lint:fix    # apply safe fixes
  ```

- Match the surrounding code: naming, comment density, idioms.
- **IPC:** typed channels only, declared in a domain `contracts.ts` and merged
  into `electron/ipc/contracts.ts`. No raw channel strings in feature code.
- **UI:** dark-first. Use the design tokens (`var(--…)`), never hardcoded
  colors or spacing. `src/design/tokens.test.ts` fails on undefined tokens. Every
  screen handles its listed states: loading, empty, error, permission-denied.
- **Strings:** user-facing text goes through `t()` / `useT()` from `src/i18n`,
  with the English message in `src/i18n/locales/en.json`.
  `src/i18n/i18n.test.ts` fails when a key used in an extracted folder is
  missing. When you extract a new folder, add it to `EXTRACTED_DIRS` there.
- **Renderer vs main:** the renderer does GPU work (PixiJS, WebCodecs); main
  owns capture, the filesystem and native helpers. WebCodecs is the primary
  encode path, and ffmpeg is fallback or mux only.

## Tests

Vitest runs `.test.ts` in Node and `.test.tsx` in jsdom. fast-check is
available for property tests.

```sh
npm test                          # everything
npx vitest run src/editor/autozoom    # one folder
npm run test:watch
npm run typecheck
```

### The harness rule

The test suite is the harness, and it decides when work is done:

1. **Every new feature ships with an integration test in the harness**, and you
   run it. A feature without a passing test isn't complete.
2. **Every change is verified by a green harness run.** "It compiles" or "it
   looks right" is not done.
3. **Add edge cases for what your change could break.** Find the existing,
   error-prone components in the blast radius and add cases that exercise them.
4. **Grow coverage freely.** Add harness cases whenever they help prove a change
   is correct; no permission needed.
5. **Keep the harness lean.** Periodically refactor tests to remove duplication
   with shared fixtures, stubs and helpers.

Pure logic (time math, snapping, auto-zoom, migrations, route selection) gets
unit tests. UI gets Testing Library tests against roles and labels. Packaging
and scripts are covered by `src/design/packaging.test.ts`.

## Licensing

- Reelform is MIT. Any third-party code or asset you copy must be recorded in
  `NOTICE.md` with its license, and its notice kept intact.
- A new production dependency must have a license compatible with
  redistribution. Run `node scripts/generate-licenses.mjs` and commit the updated
  `THIRD_PARTY_LICENSES.txt`.
- Don't modify vendored MPL-2.0 (mediabunny) or GPL (FFmpeg) components without
  updating `NOTICE.md` and publishing the modified source.

## Pull requests

- Describe what changed and why, and link the spec section.
- Include screenshots for UI changes, in both dark and light themes.
- CI must be green on macOS, Windows and Linux.
