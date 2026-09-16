/**
 * Project facts the license scripts cite (repository, contact), read from
 * package.json so notices never drift from the published repo.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const LICENSES_DIR = join(ROOT, "scripts", "licenses");

/** Vendored license texts shipped next to third-party binaries. */
export const LICENSE_TEXTS = {
  "GPL-3.0": join(LICENSES_DIR, "GPL-3.0.txt"),
  "whisper.cpp-MIT": join(LICENSES_DIR, "whisper.cpp-MIT.txt"),
  "whisper-models-MIT": join(LICENSES_DIR, "whisper-models-MIT.txt"),
};

/** `git+https://host/x.git` / `https://host/x.git` → `https://host/x`. */
export function normalizeRepoUrl(url) {
  if (typeof url !== "string" || !url) return null;
  return url
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
}

/** { name, version, repository, issues, contact } from a package.json object. */
export function projectInfo(pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))) {
  const repoField = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  const repository = normalizeRepoUrl(repoField) ?? normalizeRepoUrl(pkg.homepage);
  if (!repository) throw new Error("package.json needs a repository url for license notices");
  const author = typeof pkg.author === "string" ? { name: pkg.author } : (pkg.author ?? {});
  return {
    name: pkg.name,
    version: pkg.version,
    repository,
    issues: `${repository}/issues`,
    contact: author.email ?? null,
    author: author.name ?? null,
  };
}
