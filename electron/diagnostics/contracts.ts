import { z } from "zod";
import {
  type BuildDiagnosticsOptions,
  type DiagnosticsInput,
  buildDiagnosticsBundle,
  serializeDiagnostics,
} from "./bundle";

/** IPC surface for diagnostics (S24 About › "Copy diagnostics"). */

export const diagnosticsContracts = {
  "system:copyDiagnostics": {
    name: "system:copyDiagnostics",
    request: z.void(),
    response: z.object({ ok: z.boolean(), bytes: z.number().int().min(0) }),
  },
} as const;

type DiagnosticsContracts = typeof diagnosticsContracts;

export type DiagnosticsHandlers = {
  [K in keyof DiagnosticsContracts]: (
    req: z.infer<DiagnosticsContracts[K]["request"]>,
  ) => Promise<z.infer<DiagnosticsContracts[K]["response"]>>;
};

export interface DiagnosticsDeps extends BuildDiagnosticsOptions {
  collect(): Promise<DiagnosticsInput>;
  clipboard: { writeText(text: string): void };
  onError?: ((error: unknown) => void) | undefined;
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
  };
}
