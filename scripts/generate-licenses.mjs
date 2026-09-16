#!/usr/bin/env node
/**
 * Generate THIRD_PARTY_LICENSES.txt: every production npm dependency that
 * ends up in the packaged app (package.json `dependencies` +
 * `optionalDependencies`, walked transitively through node_modules), plus the
 * non-npm components Reelform ships or downloads (Electron/Chromium, FFmpeg,
 * whisper.cpp, Whisper models). electron-builder copies the file into
 * <resources>/licenses/ on every platform (electron-builder.json5).
 *
 * Output is deterministic (sorted, no timestamps) so diffs show real changes.
 *
 * Usage: node scripts/generate-licenses.mjs [--out THIRD_PARTY_LICENSES.txt]
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LICENSE_TEXTS, ROOT, normalizeRepoUrl, projectInfo } from "./licenses/project.mjs";

const LICENSE_FILE = /^(licen[cs]e|copying|notice)([.-].*)?$/i;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Directory of `name` as Node would resolve it from `fromDir`: the nearest
 * `node_modules/<name>` walking up, never above `root`. Null when not installed.
 */
export function resolvePackageDir(name, fromDir, root) {
  let dir = resolve(fromDir);
  const top = resolve(root);
  for (;;) {
    const candidate = join(dir, "node_modules", name, "package.json");
    if (existsSync(candidate)) return dirname(candidate);
    if (dir === top) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** SPDX-ish license string from a package.json (`license`, legacy `licenses`). */
export function licenseOf(pkg) {
  if (typeof pkg.license === "string" && pkg.license) return pkg.license;
  if (pkg.license && typeof pkg.license.type === "string") return pkg.license.type;
  if (Array.isArray(pkg.licenses) && pkg.licenses.length) {
    const types = pkg.licenses.map((l) => (typeof l === "string" ? l : l?.type)).filter(Boolean);
    if (types.length) return types.length === 1 ? types[0] : `(${types.join(" OR ")})`;
  }
  return "UNKNOWN";
}

/** License/notice files at the top of a package directory, sorted. */
export function findLicenseFiles(dir) {
  return readdirSync(dir)
    .filter((f) => LICENSE_FILE.test(f) && statSync(join(dir, f)).isFile())
    .sort();
}

/**
 * Transitive production packages reachable from the root manifest. A missing
 * required dependency throws (the tree is incomplete: run `npm ci`); a missing
 * optional one is skipped. Deduplicated by name@version, sorted.
 */
export function collectProductionPackages(root = ROOT) {
  const rootPkg = readJson(join(root, "package.json"));
  const found = new Map();
  const queue = [];
  const enqueue = (pkg, fromDir, owner) => {
    const optional = new Set(Object.keys(pkg.optionalDependencies ?? {}));
    const names = new Set([...Object.keys(pkg.dependencies ?? {}), ...optional]);
    for (const name of [...names].sort())
      queue.push({ name, fromDir, optional: optional.has(name), owner });
  };
  enqueue(rootPkg, root, rootPkg.name);
  while (queue.length > 0) {
    const { name, fromDir, optional, owner } = queue.shift();
    const dir = resolvePackageDir(name, fromDir, root);
    if (!dir) {
      if (optional) continue;
      throw new Error(`${name} (required by ${owner}) is not installed; run npm ci first`);
    }
    const pkg = readJson(join(dir, "package.json"));
    const id = `${pkg.name ?? name}@${pkg.version ?? "0.0.0"}`;
    if (found.has(id)) continue;
    const repoField = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
    found.set(id, {
      name: pkg.name ?? name,
      version: pkg.version ?? "0.0.0",
      license: licenseOf(pkg),
      repository: normalizeRepoUrl(repoField) ?? pkg.homepage ?? null,
      dir,
      licenseFiles: findLicenseFiles(dir),
    });
    enqueue(pkg, dir, id);
  }
  return [...found.values()].sort((a, b) =>
    a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name),
  );
}

/** Components that are not production npm dependencies but ship with (or are fetched by) the app. */
export function bundledComponents(root = ROOT) {
  const electronDir = join(root, "node_modules", "electron");
  const electronPkg = existsSync(join(electronDir, "package.json"))
    ? readJson(join(electronDir, "package.json"))
    : null;
  const electronLicense = join(electronDir, "LICENSE");
  return [
    {
      name: "Electron",
      version: electronPkg?.version ?? "unknown",
      license: "MIT",
      repository: "https://github.com/electron/electron",
      text: existsSync(electronLicense) ? readFileSync(electronLicense, "utf8") : null,
      note:
        "Includes Chromium, Node.js and their dependencies. Their licenses ship with the " +
        "Electron runtime as LICENSES.chromium.html next to the app executable.",
    },
    {
      name: "FFmpeg / FFprobe",
      version: "9.0.1",
      license: "GPL-3.0-or-later",
      repository: "https://ffmpeg.org",
      text: readFileSync(LICENSE_TEXTS["GPL-3.0"], "utf8"),
      note:
        "Unmodified static executables run as separate processes. The license text, " +
        "exact upstream sources, build scripts and a written source offer are in " +
        "<resources>/ffmpeg/<platform>-<arch>/LICENSE.txt and SOURCE.txt.",
    },
    {
      name: "whisper.cpp",
      version: "v1.7.6",
      license: "MIT",
      repository: "https://github.com/ggml-org/whisper.cpp",
      text: readFileSync(LICENSE_TEXTS["whisper.cpp-MIT"], "utf8"),
      note: "Built unmodified from the pinned tag as the whisper-cli captions runtime.",
    },
    {
      name: "OpenAI Whisper models (ggml conversions)",
      version: "tiny.en / base / small / medium",
      license: "MIT",
      repository: "https://github.com/openai/whisper",
      text: readFileSync(LICENSE_TEXTS["whisper-models-MIT"], "utf8"),
      note:
        "Not bundled: downloaded on demand from huggingface.co/ggerganov/whisper.cpp " +
        "with sha256 verification.",
    },
  ];
}

const RULE = "=".repeat(78);

function section(title, meta, bodies) {
  return [RULE, title, ...meta.filter(Boolean), RULE, "", ...bodies, ""].join("\n");
}

/** Render the whole notice file from collected data (pure; unit-tested). */
export function renderThirdPartyLicenses({
  project,
  packages,
  bundled,
  readText = (p) => readFileSync(p, "utf8"),
}) {
  const out = [
    `${project.name ?? "Reelform"} — third-party licenses`,
    "",
    "Reelform itself is MIT-licensed (LICENSE). Attributions and notes: NOTICE.md.",
    `Source: ${project.repository}`,
    "Regenerate with: node scripts/generate-licenses.mjs",
    "",
    `Bundled components: ${bundled.length}. npm production packages: ${packages.length}.`,
    "",
  ];
  for (const c of bundled) {
    out.push(
      section(
        `${c.name} ${c.version}`,
        [
          `License: ${c.license}`,
          c.repository ? `Source: ${c.repository}` : null,
          c.note ? `Note: ${c.note}` : null,
        ],
        [c.text ? c.text.trim() : `(License text: see ${c.repository})`],
      ),
    );
  }
  for (const p of packages) {
    const bodies = p.licenseFiles.length
      ? p.licenseFiles.map((f) =>
          p.licenseFiles.length > 1
            ? `--- ${f} ---\n${readText(join(p.dir, f)).trim()}`
            : readText(join(p.dir, f)).trim(),
        )
      : [`(No license file in the package; declared license: ${p.license}.)`];
    out.push(
      section(
        `${p.name} ${p.version}`,
        [`License: ${p.license}`, p.repository ? `Source: ${p.repository}` : null],
        bodies,
      ),
    );
  }
  return `${out.join("\n").replace(/\r\n/g, "\n").trimEnd()}\n`;
}

function main() {
  const oi = process.argv.indexOf("--out");
  const out = resolve(
    ROOT,
    oi > 0 && process.argv[oi + 1] ? process.argv[oi + 1] : "THIRD_PARTY_LICENSES.txt",
  );
  const packages = collectProductionPackages(ROOT);
  const text = renderThirdPartyLicenses({
    project: projectInfo(),
    packages,
    bundled: bundledComponents(ROOT),
  });
  writeFileSync(out, text);
  const unknown = packages
    .filter((p) => p.license === "UNKNOWN")
    .map((p) => `${p.name}@${p.version}`);
  console.log(`generate-licenses: ${packages.length} packages → ${out}`);
  if (unknown.length)
    console.warn(`generate-licenses: no declared license for ${unknown.join(", ")}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(`generate-licenses: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
