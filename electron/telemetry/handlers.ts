import type { z } from "zod";
import { type PathOps, isInsideRoot } from "../media/roots";
import { TelemetryFile } from "../recording/telemetry";
import type { TelemetryErrorCode, TelemetryReadRequest, telemetryContracts } from "./contracts";

/**
 * `telemetry:read` handler. The file must resolve (after symlinks) inside an
 * allowed media root: the addressed project's folder, or for absolute paths
 * one of the project / recording roots main passes in. Anything else is
 * `TELEMETRY_PATH_FORBIDDEN`, so a renderer cannot read arbitrary files.
 */

export class TelemetryError extends Error {
  readonly code: TelemetryErrorCode;
  readonly details?: unknown;
  constructor(code: TelemetryErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "TelemetryError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export interface TelemetryDeps {
  readFile(path: string): Promise<Uint8Array>;
  gunzip(bytes: Uint8Array): Promise<Uint8Array>;
  realpath(path: string): Promise<string>;
  path: PathOps;
  /** Project folder for an id (throws PROJECT_NOT_FOUND like `project:resolve`). */
  resolveProjectDir(projectId: string): Promise<string>;
  /** Roots an absolute-path request may read from (project dirs, recordings folders). */
  allowedRoots(): Promise<readonly string[]>;
  /** Refuse files larger than this many bytes (compressed). Default 256 MB. */
  maxBytes?: number | undefined;
}

type Handlers = {
  [K in keyof typeof telemetryContracts]: (
    req: z.infer<(typeof telemetryContracts)[K]["request"]>,
  ) => Promise<z.infer<(typeof telemetryContracts)[K]["response"]>>;
};

const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

const isGzip = (b: Uint8Array): boolean => b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b;

export function createTelemetryHandlers(deps: TelemetryDeps): Handlers {
  const forbidden = (): TelemetryError =>
    new TelemetryError("TELEMETRY_PATH_FORBIDDEN", "Telemetry path is outside the media roots");

  const target = async (req: TelemetryReadRequest): Promise<{ file: string; roots: string[] }> => {
    if ("path" in req) {
      if (!deps.path.isAbsolute(req.path)) throw forbidden();
      return { file: req.path, roots: [...(await deps.allowedRoots())] };
    }
    const dir = await deps.resolveProjectDir(req.projectId);
    const ref = req.ref.path;
    const file = deps.path.isAbsolute(ref) ? ref : deps.path.resolve(dir, ref);
    return { file, roots: [dir] };
  };

  return {
    "telemetry:read": async (req) => {
      const { file, roots } = await target(req);
      let real: string;
      try {
        real = await deps.realpath(file);
      } catch {
        // Check the lexical path first so a missing file outside the roots is still forbidden.
        const lexicalOk = roots.some((r) => isInsideRoot(r, file, deps.path) && r !== file);
        if (!lexicalOk) throw forbidden();
        throw new TelemetryError("TELEMETRY_NOT_FOUND", "Telemetry file not found");
      }
      const realRoots = await Promise.all(roots.map((r) => deps.realpath(r).catch(() => null)));
      const inside = realRoots.some(
        (r) => r !== null && r !== real && isInsideRoot(r, real, deps.path),
      );
      if (!inside) throw forbidden();

      let bytes: Uint8Array;
      try {
        bytes = await deps.readFile(real);
      } catch {
        throw new TelemetryError("TELEMETRY_NOT_FOUND", "Telemetry file not readable");
      }
      if (bytes.byteLength > (deps.maxBytes ?? DEFAULT_MAX_BYTES)) {
        throw new TelemetryError("TELEMETRY_CORRUPT", "Telemetry file is too large");
      }

      let parsed: unknown;
      try {
        const raw = isGzip(bytes) ? await deps.gunzip(bytes) : bytes;
        parsed = JSON.parse(new TextDecoder().decode(raw));
      } catch {
        throw new TelemetryError("TELEMETRY_CORRUPT", "Telemetry file is not valid gzip JSON");
      }
      const result = TelemetryFile.safeParse(parsed);
      if (!result.success) {
        throw new TelemetryError(
          "TELEMETRY_INVALID",
          "Telemetry file does not match the schema",
          result.error.issues.slice(0, 5),
        );
      }
      return result.data;
    },
  };
}
