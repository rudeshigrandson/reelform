import { z } from "zod";
import {
  type BuildDiagnosticsOptions,
  type DiagnosticsInput,
  buildDiagnosticsBundle,
  serializeDiagnostics,
} from "./bundle";

/**
 * IPC surface for diagnostics and the Settings system utilities (S24 About ›
 * "Copy diagnostics"; Advanced › logs folder / cache; General › save folder).
 */

export const diagnosticsContracts = {
  "system:copyDiagnostics": {
    name: "system:copyDiagnostics",
    request: z.void(),
    response: z.object({ ok: z.boolean(), bytes: z.number().int().min(0) }),
  },
  "system:openLogsFolder": {
    name: "system:openLogsFolder",
    request: z.void(),
    response: z.object({ ok: z.boolean() }),
  },
  "system:cacheInfo": {
    name: "system:cacheInfo",
    request: z.void(),
    /** `bytes` null when the cache size cannot be read. */
    response: z.object({
      bytes: z.number().int().min(0).nullable(),
      /** Per-area sizes when known: Chromium session cache, project caches, app caches. */
      breakdown: z
        .object({
          sessionBytes: z.number().int().min(0).nullable(),
          projectsBytes: z.number().int().min(0),
          extraBytes: z.number().int().min(0),
        })
        .optional(),
    }),
  },
  "system:clearCache": {
    name: "system:clearCache",
    request: z.void(),
    response: z.object({ ok: z.boolean() }),
  },
  "system:pickFolder": {
    name: "system:pickFolder",
    request: z.object({
      title: z.string().max(200).optional(),
      defaultPath: z.string().optional(),
    }),
    /** null when the user cancelled. */
    response: z.object({ path: z.string().min(1).nullable() }),
  },
} as const;

type DiagnosticsContracts = typeof diagnosticsContracts;

export type DiagnosticsHandlers = {
  [K in keyof DiagnosticsContracts]: (
    req: z.infer<DiagnosticsContracts[K]["request"]>,
  ) => Promise<z.infer<DiagnosticsContracts[K]["response"]>>;
};

/** OS utilities behind the Settings buttons; each is optional so tests can omit them. */
export interface SystemUtilities {
  openLogsFolder?: (() => Promise<boolean>) | undefined;
  cacheSize?: (() => Promise<number>) | undefined;
  /** Preferred over `cacheSize` when present: sizes per cache area. */
  cacheBreakdown?:
    | (() => Promise<{ sessionBytes: number | null; projectsBytes: number; extraBytes: number }>)
    | undefined;
  clearCache?: (() => Promise<void>) | undefined;
  pickFolder?:
    | ((opts: { title?: string | undefined; defaultPath?: string | undefined }) => Promise<
        string | null
      >)
    | undefined;
}

export interface DiagnosticsDeps extends BuildDiagnosticsOptions {
  collect(): Promise<DiagnosticsInput>;
  clipboard: { writeText(text: string): void };
  onError?: ((error: unknown) => void) | undefined;
  system?: SystemUtilities | undefined;
}

export function createDiagnosticsHandlers(deps: DiagnosticsDeps): DiagnosticsHandlers {
  return {
    "system:copyDiagnostics": async () => {
      try {
        const text = serializeDiagnostics(buildDiagnosticsBundle(await deps.collect(), deps));
        deps.clipboard.writeText(text);
        return { ok: true, bytes: new TextEncoder().encode(text).byteLength };
      } catch (e) {
        deps.onError?.(e);
        return { ok: false, bytes: 0 };
      }
    },
    "system:openLogsFolder": async () => {
      const open = deps.system?.openLogsFolder;
      if (!open) return { ok: false };
      try {
        return { ok: await open() };
      } catch (e) {
        deps.onError?.(e);
        return { ok: false };
      }
    },
    "system:cacheInfo": async () => {
      const breakdown = deps.system?.cacheBreakdown;
      if (breakdown) {
        const clean = (n: number | null): number | null =>
          n !== null && Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
        try {
          const b = await breakdown();
          const sessionBytes = clean(b.sessionBytes);
          const projectsBytes = clean(b.projectsBytes) ?? 0;
          const extraBytes = clean(b.extraBytes) ?? 0;
          return {
            bytes: (sessionBytes ?? 0) + projectsBytes + extraBytes,
            breakdown: { sessionBytes, projectsBytes, extraBytes },
          };
        } catch (e) {
          deps.onError?.(e);
          return { bytes: null };
        }
      }
      const size = deps.system?.cacheSize;
      if (!size) return { bytes: null };
      try {
        const bytes = await size();
        return { bytes: Number.isFinite(bytes) && bytes >= 0 ? Math.round(bytes) : null };
      } catch (e) {
        deps.onError?.(e);
        return { bytes: null };
      }
    },
    "system:clearCache": async () => {
      const clear = deps.system?.clearCache;
      if (!clear) return { ok: false };
      try {
        await clear();
        return { ok: true };
      } catch (e) {
        deps.onError?.(e);
        return { ok: false };
      }
    },
    "system:pickFolder": async (req) => {
      const pick = deps.system?.pickFolder;
      if (!pick) return { path: null };
      try {
        const path = await pick({ title: req.title, defaultPath: req.defaultPath });
        return { path: path && path.length > 0 ? path : null };
      } catch (e) {
        deps.onError?.(e);
        return { path: null };
      }
    },
  };
}
