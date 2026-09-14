import type { BackendId, CaptureBackend } from "./types";

/**
 * Backend selection (ENGINEERING_SPEC §5.1): user override → native for the OS
 * if available → `electron`. Every skipped candidate contributes a human
 * readable reason (shown in Advanced settings / diagnostics).
 */

/** Native backends per `process.platform`, in preference order. */
export function nativeBackendsFor(platform: string): BackendId[] {
  switch (platform) {
    case "darwin":
      return ["sck"];
    case "win32":
      return ["wgc", "dxgi"];
    default:
      return [];
  }
}

export interface SelectionInput {
  override?: BackendId | null | undefined;
  platform: string;
  backends: readonly CaptureBackend[];
}

export interface SelectionResult {
  backend: CaptureBackend | null;
  /** Why earlier candidates were skipped (empty when the first choice won). */
  reasons: string[];
}

export async function selectBackend(input: SelectionInput): Promise<SelectionResult> {
  const reasons: string[] = [];
  const byId = new Map(input.backends.map((b) => [b.id, b] as const));
  const order: BackendId[] = [];
  const push = (id: BackendId): void => {
    if (!order.includes(id)) order.push(id);
  };
  if (input.override) push(input.override);
  for (const id of nativeBackendsFor(input.platform)) push(id);
  push("electron");

  for (const id of order) {
    const label = id === input.override ? `override ${id}` : id;
    const backend = byId.get(id);
    if (!backend) {
      reasons.push(`${label}: not built for this platform`);
      continue;
    }
    let ok = false;
    let reason: string | undefined;
    try {
      const a = await backend.isAvailable();
      ok = a.ok;
      reason = a.reason;
    } catch (err) {
      reason = err instanceof Error ? err.message : String(err);
    }
    if (ok) return { backend, reasons };
    reasons.push(`${label}: ${reason ?? "unavailable"}`);
  }
  return { backend: null, reasons };
}
