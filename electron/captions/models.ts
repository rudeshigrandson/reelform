/**
 * Whisper model catalog (ENGINEERING_SPEC §9.6).
 *
 * Files come from the `ggerganov/whisper.cpp` Hugging Face repo, pinned to a
 * revision so the checksums below cannot drift. Every entry pins a sha256:
 * the downloader refuses to install a file whose bytes do not match.
 *
 * Source of every `sha256` / `sizeBytes` (checked 2026-09-15 against
 * revision {@link HF_REVISION}):
 *  - Hub tree API `https://huggingface.co/api/models/ggerganov/whisper.cpp/tree/main`
 *    (`lfs.oid` / `lfs.size`; `main` resolved to HF_REVISION via
 *    `/api/models/ggerganov/whisper.cpp/revision/main`), and
 *  - `x-linked-etag` / `x-linked-size` headers of `HEAD <url>` at HF_REVISION.
 * Both agree for all four files. tiny.en-q5_1 was additionally downloaded in
 * full from its pinned URL and `shasum -a 256` matched, as did its byte size.
 */

export type ModelTier = "fast" | "balanced" | "accurate";

export const MODEL_IDS = ["tiny.en-q5_1", "base-q5_1", "small-q5_1", "medium-q5_0"] as const;
export type ModelId = (typeof MODEL_IDS)[number];

export interface ModelSpec {
  id: ModelId;
  tier: ModelTier;
  label: string;
  fileName: string;
  url: string;
  /** Exact byte size of the file at the pinned revision. */
  sizeBytes: number;
  /** Rounded display size. */
  displaySize: string;
  /** Lower-case hex sha256 of the file at the pinned revision (LFS oid). */
  sha256: string;
  /** `.en` models only transcribe English. */
  englishOnly: boolean;
}

export const HF_REPO = "ggerganov/whisper.cpp";
/** Hub commit the sha256/size values below were read from. */
export const HF_REVISION = "5359861c739e955e79d9a303bcbc70fb988958b1";

const hfUrl = (fileName: string): string =>
  `https://huggingface.co/${HF_REPO}/resolve/${HF_REVISION}/${fileName}`;

const spec = (s: Omit<ModelSpec, "url">): ModelSpec => ({ ...s, url: hfUrl(s.fileName) });

export const MODEL_CATALOG: readonly ModelSpec[] = [
  spec({
    id: "tiny.en-q5_1",
    tier: "fast",
    label: "Fast",
    fileName: "ggml-tiny.en-q5_1.bin",
    sizeBytes: 32_166_155,
    displaySize: "32 MB",
    // Hub lfs.oid + x-linked-etag; verified by full download + shasum -a 256.
    sha256: "c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b",
    englishOnly: true,
  }),
  spec({
    id: "base-q5_1",
    tier: "balanced",
    label: "Balanced (base)",
    fileName: "ggml-base-q5_1.bin",
    sizeBytes: 59_707_625,
    displaySize: "60 MB",
    // Hub lfs.oid + x-linked-etag at HF_REVISION.
    sha256: "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898",
    englishOnly: false,
  }),
  spec({
    id: "small-q5_1",
    tier: "balanced",
    label: "Balanced",
    fileName: "ggml-small-q5_1.bin",
    sizeBytes: 190_085_487,
    displaySize: "190 MB",
    // Hub lfs.oid + x-linked-etag at HF_REVISION.
    sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb",
    englishOnly: false,
  }),
  spec({
    id: "medium-q5_0",
    tier: "accurate",
    label: "Accurate",
    fileName: "ggml-medium-q5_0.bin",
    sizeBytes: 539_212_467,
    displaySize: "540 MB",
    // Hub lfs.oid + x-linked-etag at HF_REVISION.
    sha256: "19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f",
    englishOnly: false,
  }),
];

/** The model each UI tier maps to by default (Balanced → small, per §9.6 "~190MB"). */
export const DEFAULT_MODEL_FOR_TIER: Readonly<Record<ModelTier, ModelId>> = {
  fast: "tiny.en-q5_1",
  balanced: "small-q5_1",
  accurate: "medium-q5_0",
};

export function findModel(id: string): ModelSpec | undefined {
  return MODEL_CATALOG.find((m) => m.id === id);
}

export function isSha256Hex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}
