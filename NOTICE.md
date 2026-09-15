# Third-Party Notices & Attributions

Reelform is itself MIT-licensed (see `LICENSE`). This file records the
third-party projects Reelform references, bundles, downloads at runtime, or
incorporates code/assets from.

Packaged builds ship this file, `LICENSE` and a generated
`THIRD_PARTY_LICENSES.txt` (every production npm package with its full license
text, produced by `scripts/generate-licenses.mjs`) in `<resources>/licenses/`
on macOS, Windows and Linux.

---

## OpenScreen (reference only)

- Project: OpenScreen — free, open-source screen recorder / demo tool.
- Source: https://github.com/siddharthvaddem/openscreen
- License: MIT License
- Used as: reference architecture and design/quality benchmark. Reelform
  contains no OpenScreen source code or assets.

If any OpenScreen source code or assets are ever copied into Reelform, the MIT
license below must remain in place for those portions and this entry must be
updated to list them.

```
MIT License

Copyright (c) 2025 Siddharth Vaddem

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Electron, Chromium and Node.js (runtime)

- Project: Electron — https://github.com/electron/electron — Copyright (c) Electron contributors,
  Copyright (c) 2013-2020 GitHub Inc.
- License: MIT. Electron embeds Chromium (BSD-3-Clause and many third-party
  licenses) and Node.js (MIT and others).
- Used as: the application runtime, shipped unmodified by electron-builder. Electron's
  own `LICENSE` and the full Chromium/Node.js notice file `LICENSES.chromium.html`
  are included next to the app executable in every packaged build. The Electron
  license text is also reproduced in `THIRD_PARTY_LICENSES.txt`.

## mediabunny

- Project: mediabunny — https://github.com/Vanilagy/mediabunny
- License: Mozilla Public License 2.0 (MPL-2.0)
- Version: as locked in `package-lock.json` (1.56.x at the time of writing).
- Used as: MP4/WebM muxing and demuxing in the export engine, bundled into the
  renderer JavaScript **unmodified**. Under MPL-2.0 §3.2 the Source Code Form of
  the covered files is available from the upstream repository at the matching
  tag (for example https://github.com/Vanilagy/mediabunny/tree/v1.56.2) and in the
  npm package (`node_modules/mediabunny`). Reelform's own code is not covered by
  the MPL. If mediabunny files are ever modified, the modified files must be
  published under MPL-2.0 and listed here.

## Other npm runtime packages

React, React DOM, PixiJS, Zustand, immer, zod, electron-updater and their
transitive dependencies are bundled into the app. Each package, its version,
declared license and full license text are listed in `THIRD_PARTY_LICENSES.txt`,
regenerated with `node scripts/generate-licenses.mjs` before packaging.

## Figtree (font)

- Project: Figtree — https://github.com/erikdkennedy/figtree
- Copyright 2022 The Figtree Project Authors
- License: SIL Open Font License, Version 1.1 (https://openfontlicense.org)
- Used as: UI body font. Bundled files `src/design/fonts/figtree-latin-{400,600,700}-normal.woff2`,
  copied unmodified from `@fontsource/figtree` 5.3.0.

## Caprasimo (font)

- Project: Caprasimo — https://github.com/docrepair-fonts/caprasimo-fonts
- Copyright 2023 The Caprasimo Project Authors
- License: SIL Open Font License, Version 1.1 (https://openfontlicense.org)
- Used as: heading font. Bundled file `src/design/fonts/caprasimo-latin-400-normal.woff2`,
  copied unmodified from `@fontsource/caprasimo` 5.3.0.

The fonts are redistributed with the application only, are not sold by
themselves, and keep their original names. The full OFL 1.1 text ships with
the upstream packages (`node_modules/@fontsource/*/LICENSE`, reproduced in
`THIRD_PARTY_LICENSES.txt`) and is summarized here:

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of the Font Software, to use, study, copy, merge, embed, modify, redistribute,
> and sell modified and unmodified copies of the Font Software, subject to the
> following conditions: (1) neither the Font Software nor any of its individual
> components, in Original or Modified Versions, may be sold by itself; (2)
> Original or Modified Versions of the Font Software may be bundled,
> redistributed and/or sold with any software, provided that each copy contains
> the above copyright notice and this license; (3) no Modified Version of the
> Font Software may use the Reserved Font Name(s) unless explicit written
> permission is granted; (4) the names of the Copyright Holder(s) and the
> Author(s) shall not be used to promote Modified Versions; (5) the Font
> Software, modified or unmodified, must be distributed entirely under this
> license. THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.

## Bundled original assets

Wallpapers (`public/wallpapers/wallpapers.json`), cursor packs
(`public/cursors/`), click sounds (`public/sounds/`) and app/tray icons
(`build/`) are original works generated by the scripts in `scripts/` and are
covered by Reelform's MIT license. No operating-system cursor or wallpaper
artwork is included.

## whisper.cpp (bundled captions runtime)

- Project: whisper.cpp — https://github.com/ggml-org/whisper.cpp — Copyright (c) 2023-2024 The ggml authors
- License: MIT
- Version: tag `v1.7.6`, built unmodified by `scripts/build-whisper-runtime.mjs` into
  `resources/whisper/<platform>-<arch>/whisper-cli[.exe]`.
- Used as: a separate executable the main process runs to transcribe captions on-device.
  Each runtime folder ships `LICENSE.txt` (the MIT text) and `SOURCE.txt` (upstream tag and
  the exact CMake flags). The license text is vendored at `scripts/licenses/whisper.cpp-MIT.txt`.

## OpenAI Whisper model weights (downloaded on demand)

- Project: Whisper — https://github.com/openai/whisper — Copyright (c) 2022 OpenAI
- License: MIT (applies to the code and the model weights)
- Used as: `ggml-*.bin` conversions (tiny.en, base, small, medium) from
  https://huggingface.co/ggerganov/whisper.cpp at a pinned revision. They are **not bundled**:
  the user picks a model and Reelform downloads it into `userData/models` with sha256
  verification (`electron/captions/models.ts`). The license text is vendored at
  `scripts/licenses/whisper-models-MIT.txt` and included in each whisper runtime `LICENSE.txt`.

## FFmpeg / FFprobe (bundled binaries)

- Project: FFmpeg — https://ffmpeg.org — Copyright (c) 2000-2026 the FFmpeg developers
- Version: 9.0.1 static builds, fetched and sha256-verified by `scripts/fetch-ffmpeg.mjs`
  into `resources/ffmpeg/<platform>-<arch>/` (with a `manifest.json` of sources and hashes).
- License: **GNU GPL v3 or later** for every pinned build (configured `--enable-gpl
  --enable-version3`; they include GPL components such as libx264/libx265). LGPL-only
  builds were not used because no equivalent verifiable macOS build was available.
- Used as: separate executables that Reelform spawns as child processes for mux and
  transcode fallbacks. Reelform does not link against FFmpeg libraries; the binaries
  are shipped unmodified alongside the MIT-licensed app (aggregation).
- GPL compliance: next to the binaries, every packaged build ships `LICENSE.txt` (the
  verbatim GPLv3 text, vendored at `scripts/licenses/GPL-3.0.txt`) and `SOURCE.txt`
  (the upstream FFmpeg 9.0.1 release tarball and git tag, each archive's URL, sha256,
  builder, exact source and build-script links, and a written offer to provide the
  corresponding source for at least three years).
- Builds:
  - macOS arm64 / x64: Martin Riedl's FFmpeg Build Server release builds,
    https://ffmpeg.martin-riedl.de/ (build scripts: https://git.martin-riedl.de/ffmpeg/build-script).
  - Windows x64: gyan.dev "essentials" build, https://github.com/GyanD/codexffmpeg/releases/tag/9.0.1
    (source: https://github.com/FFmpeg/FFmpeg/commit/bf1b838f2a).
  - Windows arm64 / Linux x64: BtbN FFmpeg-Builds `gpl-9.0` variant,
    https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-08-31-13-27
    (source: https://github.com/FFmpeg/FFmpeg/commit/e47273f4d9).
- Not used: Martin Riedl's Linux build, which is configured `--enable-nonfree` and
  therefore not redistributable.
