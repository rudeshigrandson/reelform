import { create } from "zustand";

/**
 * Background export progress for the top-bar ring and the S28 progress toast.
 * One export at a time per editor window.
 */

export type ExportActivity = "idle" | "running" | "done" | "failed" | "cancelled";

export interface ExportProgressData {
  activity: ExportActivity;
  /** 0..1 over the whole job. */
  fraction: number;
  label: string;
  framesDone: number;
  framesTotal: number;
  etaMs: number | null;
  speed: number | null;
  fileName: string | null;
  path: string | null;
  bytes: number | null;
  estimatedBytes: number | null;
  error: string | null;
}

export interface ExportProgressState extends ExportProgressData {
  set(patch: Partial<ExportProgressData>): void;
  reset(): void;
}

export function initialExportProgress(): ExportProgressData {
  return {
    activity: "idle",
    fraction: 0,
    label: "",
    framesDone: 0,
    framesTotal: 0,
    etaMs: null,
    speed: null,
    fileName: null,
    path: null,
    bytes: null,
    estimatedBytes: null,
    error: null,
  };
}

export const useExportProgress = create<ExportProgressState>((set) => ({
  ...initialExportProgress(),
  set: (patch) => set(patch),
  reset: () => set(initialExportProgress()),
}));

/** Top-bar progress ring value in [0, 1], or null when no export is running. */
export function progressRingValue(
  s: Pick<ExportProgressData, "activity" | "fraction">,
): number | null {
  if (s.activity !== "running") return null;
  return Number.isFinite(s.fraction) ? Math.min(1, Math.max(0, s.fraction)) : 0;
}

export const useExportProgressRing = (): number | null => useExportProgress(progressRingValue);
