/**
 * electron-builder `afterPack` hook: keep the native helper sha256 manifests
 * (`<resources>/bin/<platform>-<arch>/manifest.json`, verified by
 * electron/capture/manifest.ts before every spawn) true to the bytes that ship.
 *
 * Code signing rewrites executables, so a manifest hashed at build time would
 * make every helper fail verification in a signed build:
 *   - Windows: electron-builder signs `.exe` extraResources while copying them,
 *     i.e. BEFORE this hook, so re-hashing here is enough.
 *   - macOS: osx-sign would sign AFTER this hook and after hashing, and editing
 *     manifest.json after signing breaks the bundle seal. So this hook signs the
 *     helpers itself (Developer ID, hardened runtime, timestamp, inherited
 *     entitlements), re-hashes them, and `mac.signIgnore` keeps osx-sign away
 *     from `Contents/Resources/bin/`.
 *   - Universal mac builds call this hook for the x64/arm64 temp apps first;
 *     those are skipped so the helper bytes stay identical for `x64ArchFiles`.
 *
 * CommonJS on purpose: package.json is `"type": "module"`, and electron-builder
 * loads hook files with require().
 */
"use strict";

const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { existsSync, readFileSync, readdirSync, statSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const INHERIT_ENTITLEMENTS = path.join(ROOT, "build", "entitlements.mac.inherit.plist");

/** Per-arch app dirs electron-builder packs before merging a universal app. */
function isUniversalIntermediate(appOutDir) {
  return /-(x64|arm64)-temp[\\/]?$/.test(appOutDir);
}

function resourcesDir(context) {
  if (context.electronPlatformName === "darwin" || context.electronPlatformName === "mas") {
    const app = `${context.packager.appInfo.productFilename}.app`;
    return path.join(context.appOutDir, app, "Contents", "Resources");
  }
  return path.join(context.appOutDir, "resources");
}

/** `bin/<platform-arch>` dirs that carry a manifest. */
function helperDirs(binDir) {
  if (!existsSync(binDir)) return [];
  return readdirSync(binDir)
    .map((name) => path.join(binDir, name))
    .filter((dir) => statSync(dir).isDirectory() && existsSync(path.join(dir, "manifest.json")));
}

/** Files listed in a helper dir's manifest (absolute paths). Throws if one is missing. */
function listedFiles(dir) {
  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
  return Object.keys(manifest.files ?? {}).map((name) => {
    if (name.includes("/") || name.includes("\\") || name === "..")
      throw new Error(`helper manifest entry must be a bare file name: ${name}`);
    const file = path.join(dir, name);
    if (!existsSync(file)) throw new Error(`helper listed in manifest is missing: ${file}`);
    return file;
  });
}

/**
 * Re-hash every file listed in each manifest under `binDir`, keeping `version`
 * and the listed set unchanged. Returns the rewritten manifest paths.
 */
function rewriteHelperManifests(binDir) {
  const written = [];
  for (const dir of helperDirs(binDir)) {
    const manifestPath = path.join(dir, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const files = {};
    for (const file of listedFiles(dir).sort()) {
      files[path.basename(file)] = {
        sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
      };
    }
    const next = manifest.version === undefined ? { files } : { version: manifest.version, files };
    writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
    written.push(manifestPath);
  }
  return written;
}

/** `codesign` argv for one helper (pure; unit-tested). */
function codesignArgs(file, identity, keychainFile) {
  const args = [
    "--force",
    "--options",
    "runtime",
    "--timestamp",
    "--entitlements",
    INHERIT_ENTITLEMENTS,
    "--sign",
    identity,
  ];
  if (keychainFile) args.push("--keychain", keychainFile);
  args.push(file);
  return args;
}

/**
 * Signing identity electron-builder will use for the app, or null for an
 * unsigned build (then osx-sign does not run either and bytes stay as built).
 * Uses electron-builder internals (MacPackager.codeSigningInfo / helper), so it
 * is guarded: any failure means "no identity" plus a warning.
 */
async function resolveMacIdentity(packager) {
  if (process.env.CSC_IDENTITY_AUTO_DISCOVERY === "false" && !process.env.CSC_NAME) return null;
  try {
    const { keychainFile } = await packager.codeSigningInfo.value;
    const config = packager.platformSpecificBuildOptions ?? {};
    const qualifier = config.identity ?? process.env.CSC_NAME ?? null;
    if (qualifier === null && config.identity === null) return null;
    const identity = await packager.helper.findSigningIdentity(
      false,
      false,
      qualifier,
      keychainFile,
      config,
    );
    if (!identity) return null;
    return { identity: identity.hash || identity.name, keychainFile };
  } catch (err) {
    console.warn(`after-pack: could not resolve a macOS signing identity (${err.message})`);
    return null;
  }
}

async function afterPack(context) {
  const binDir = path.join(resourcesDir(context), "bin");
  if (helperDirs(binDir).length === 0) return;
  const mac = context.electronPlatformName === "darwin";
  if (mac && isUniversalIntermediate(context.appOutDir)) return;

  if (mac) {
    const signing = await resolveMacIdentity(context.packager);
    if (signing) {
      for (const dir of helperDirs(binDir)) {
        for (const file of listedFiles(dir)) {
          const r = spawnSync(
            "codesign",
            codesignArgs(file, signing.identity, signing.keychainFile),
            { stdio: "inherit" },
          );
          if (r.status !== 0) throw new Error(`codesign failed for ${file}`);
        }
      }
    }
  }
  for (const m of rewriteHelperManifests(binDir)) console.log(`after-pack: re-hashed ${m}`);
}

module.exports = afterPack;
module.exports.default = afterPack;
module.exports.isUniversalIntermediate = isUniversalIntermediate;
module.exports.rewriteHelperManifests = rewriteHelperManifests;
module.exports.codesignArgs = codesignArgs;
module.exports.resourcesDir = resourcesDir;
