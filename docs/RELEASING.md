# Releasing

Releases are built by GitHub Actions from a version tag and published through
GitHub Releases, which `electron-updater` reads. The process follows
ENGINEERING_SPEC §14.3.

## Channels

| Channel | Version | Tag | Updater |
|---|---|---|---|
| Stable | `X.Y.Z` | `vX.Y.Z` | default |
| Beta | `X.Y.Z-beta.N` | `vX.Y.Z-beta.N` | Settings › Updates › Beta (`allowPrerelease`) |

`electron-builder.json5` sets `generateUpdatesFilesForAllChannels` and
`detectUpdateChannel`, so each build publishes `latest*.yml` and `beta*.yml`.
Switching a user to Stable never downgrades them.

## Flow

1. **Version bump PR.** Update `version` in `package.json` (and the lockfile),
   regenerate `THIRD_PARTY_LICENSES.txt` (`node scripts/generate-licenses.mjs`)
   and merge to `main` through a PR with green CI.
2. **Tag.** On the merged commit:

   ```sh
   git tag vX.Y.Z-beta.1   # or vX.Y.Z
   git push origin vX.Y.Z-beta.1
   ```

3. **build.yml runs** (`.github/workflows/build.yml`, on `tags: ["v*"]`):
   - `native-mac` and `native-win` build the capture helpers
     (`scripts/build-native-helpers.mjs`);
   - `whisper` builds `whisper-cli` for darwin-arm64, darwin-x64, win32-x64 and
     linux-x64 (`scripts/build-whisper-runtime.mjs`, which also writes
     `LICENSE.txt` and `SOURCE.txt`);
   - `package` downloads those artifacts, fetches the pinned ffmpeg
     (`scripts/fetch-ffmpeg.mjs`, sha256-verified, with GPL `LICENSE.txt` and
     `SOURCE.txt`), runs `tsc` and `vite build`, then
     `electron-builder --<platform> --publish always` (signing and notarizing when
     secrets are present), writes SHA256SUMS, and uploads everything to a **draft**
     GitHub Release.
4. **QA checklist on the draft release.** Run it on each OS before publishing:
   - [ ] Record on macOS, Windows and Linux (display, window and region; mic + system audio; webcam)
   - [ ] Export MP4 and GIF (and WebM) and play them back
   - [ ] Update from the previous release on each channel (Restart to update works)
   - [ ] Permissions: revoke and re-grant Screen Recording, Microphone, Camera and Accessibility; the app recovers
   - [ ] Fresh install: onboarding runs end to end
   - [ ] Captions: download a model and transcribe
   - [ ] About › Licenses opens NOTICE.md, and `<resources>/licenses/` plus `ffmpeg/*/SOURCE.txt` are present
   - [ ] macOS: the app opens without Gatekeeper warnings (notarized, stapled); Windows: signed installer
5. **Publish to Beta.** Publish the draft as a **pre-release**. Beta users
   update automatically.
6. **Soak for 3 days on Beta.** Triage feedback; any P0 or P1 blocks promotion.
7. **Promote to Stable.** Same artifacts, no rebuild: edit the GitHub release
   and untick "pre-release", or tag and publish `vX.Y.Z` from the same commit
   for a clean stable version.

### Hotfix

Branch from the release tag (`git switch -c hotfix/X.Y.Z+1 vX.Y.Z`), fix,
bump the patch version, then tag from that branch and follow the same flow.
Merge the fix back to `main` through a PR.

## Secrets

Credentials come only from repository secrets (never from files in the repo).
If a secret is unset, that step is skipped and the build is unsigned.

| Secret | Used as | Purpose |
|---|---|---|
| `MAC_CSC_LINK` | `CSC_LINK` | Developer ID Application certificate (.p12, base64 or URL) |
| `MAC_CSC_KEY_PASSWORD` | `CSC_KEY_PASSWORD` | Password for that certificate |
| `APPLE_API_KEY_P8` | written to a file → `APPLE_API_KEY` | App Store Connect API key for notarization |
| `APPLE_API_KEY_ID` | `APPLE_API_KEY_ID` | API key id |
| `APPLE_API_ISSUER` | `APPLE_API_ISSUER` | API issuer id |
| `WIN_CSC_LINK` | `WIN_CSC_LINK` | Windows code-signing certificate (or configure Azure Trusted Signing) |
| `WIN_CSC_KEY_PASSWORD` | `WIN_CSC_KEY_PASSWORD` | Password for that certificate |
| `GITHUB_TOKEN` (built in) | `GH_TOKEN` | Upload to the draft GitHub Release |

As an alternative to the API key, notarization also accepts `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`.

Before the first signed Windows release, set `win.signtoolOptions.publisherName`
in `electron-builder.json5` to the certificate's subject CN. It's currently a
placeholder.

## Build locally

```sh
npm run native:build && npm run whisper:build && npm run ffmpeg:fetch
node scripts/generate-licenses.mjs
npm run dist            # current OS, unsigned unless CSC_* env vars are set
```

## License compliance per release

- `THIRD_PARTY_LICENSES.txt` is regenerated and committed for the release commit.
- Every packaged ffmpeg folder has `LICENSE.txt` (GPLv3) and `SOURCE.txt`
  (written offer, upstream source, build scripts). Keep the offer valid for
  three years after the last distribution of a version.
- `NOTICE.md` lists any new bundled or downloaded component.
