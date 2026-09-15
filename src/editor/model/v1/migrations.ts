import type { z } from "zod";
import { type ProjectV1, SCHEMA_VERSION, projectV1Schema } from "./project";

/**
 * `schemaVersion` migrations (ENGINEERING_SPEC §4). Each migration lifts a raw
 * document exactly one version; `migrate` chains them up to the current
 * version and then validates with the v1 schema.
 */

export type RawDocument = Record<string, unknown>;

export interface Migration {
  readonly from: number;
  readonly to: number;
  readonly description: string;
  readonly up: (raw: RawDocument) => RawDocument;
}

export const CURRENT_SCHEMA_VERSION: number = SCHEMA_VERSION;

export const MIGRATIONS: readonly Migration[] = [
  {
    from: 0,
    to: 1,
    description: "Unversioned pre-release document: stamp schemaVersion 1",
    up: (raw) => ({ ...raw, schemaVersion: 1 }),
  },
];

export type ProjectLoadErrorCode =
  | "invalid-json"
  | "not-an-object"
  | "invalid-version"
  | "future-version"
  | "no-migration-path"
  | "migration-failed"
  | "invalid-document";

export interface ProjectIssue {
  /** Dotted path with array indices, e.g. `timeline.zooms[0].level`. */
  readonly path: string;
  readonly message: string;
}

export class ProjectLoadError extends Error {
  readonly code: ProjectLoadErrorCode;
  /** The document's declared version, when readable. */
  readonly version: number | null;
  readonly issues: readonly ProjectIssue[];

  constructor(
    code: ProjectLoadErrorCode,
    message: string,
    version: number | null = null,
    issues: readonly ProjectIssue[] = [],
  ) {
    super(message);
    this.name = "ProjectLoadError";
    this.code = code;
    this.version = version;
    this.issues = issues;
  }
}

export type MigrationResult =
  | { readonly ok: true; readonly project: ProjectV1; readonly fromVersion: number }
  | { readonly ok: false; readonly error: ProjectLoadError };

export function formatIssuePath(path: readonly (string | number)[]): string {
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") out += `[${seg}]`;
    else out += out === "" ? seg : `.${seg}`;
  }
  return out === "" ? "(root)" : out;
}

export function issuesFromZod(error: z.ZodError): ProjectIssue[] {
  return error.issues.map((i) => ({ path: formatIssuePath(i.path), message: i.message }));
}

function isRecord(v: unknown): v is RawDocument {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Lift `raw` from its `schemaVersion` (missing = 0) to the current version and
 * validate it. Never throws; failures come back as a typed `ProjectLoadError`.
 */
export function migrate(
  raw: unknown,
  migrations: readonly Migration[] = MIGRATIONS,
  currentVersion: number = CURRENT_SCHEMA_VERSION,
): MigrationResult {
  const fail = (error: ProjectLoadError): MigrationResult => ({ ok: false, error });
  if (!isRecord(raw)) {
    return fail(new ProjectLoadError("not-an-object", "Project document must be a JSON object"));
  }
  // Only an absent key means "unversioned"; an explicit null is invalid.
  const declared = "schemaVersion" in raw ? raw.schemaVersion : 0;
  if (typeof declared !== "number" || !Number.isInteger(declared) || declared < 0) {
    return fail(
      new ProjectLoadError(
        "invalid-version",
        "schemaVersion must be a non-negative integer",
        null,
        [{ path: "schemaVersion", message: `got ${JSON.stringify(declared)}` }],
      ),
    );
  }
  if (declared > currentVersion) {
    return fail(
      new ProjectLoadError(
        "future-version",
        `Project was saved by a newer Reelform (schema v${declared}); this version reads up to v${currentVersion}`,
        declared,
      ),
    );
  }

  let doc: RawDocument = raw;
  let version = declared;
  while (version < currentVersion) {
    const step = migrations.find((m) => m.from === version);
    if (!step || step.to <= version || step.to > currentVersion) {
      return fail(
        new ProjectLoadError(
          "no-migration-path",
          `No migration from schema v${version} toward v${currentVersion}`,
          declared,
        ),
      );
    }
    let next: unknown;
    try {
      next = step.up(doc);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail(
        new ProjectLoadError(
          "migration-failed",
          `Migration v${step.from} -> v${step.to} failed: ${message}`,
          declared,
        ),
      );
    }
    if (!isRecord(next)) {
      return fail(
        new ProjectLoadError(
          "migration-failed",
          `Migration v${step.from} -> v${step.to} did not return an object`,
          declared,
        ),
      );
    }
    doc = next;
    version = step.to;
  }

  const parsed = projectV1Schema.safeParse(doc);
  if (!parsed.success) {
    const issues = issuesFromZod(parsed.error);
    const first = issues[0];
    const summary = first ? `${first.path}: ${first.message}` : "invalid";
    return fail(
      new ProjectLoadError(
        "invalid-document",
        `Invalid project document (${issues.length} issue${issues.length === 1 ? "" : "s"}; ${summary})`,
        declared,
        issues,
      ),
    );
  }
  return { ok: true, project: parsed.data, fromVersion: declared };
}

/** Throwing variant of {@link migrate}. */
export function loadProject(raw: unknown): ProjectV1 {
  const result = migrate(raw);
  if (!result.ok) throw result.error;
  return result.project;
}
