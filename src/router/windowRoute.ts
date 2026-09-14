import { z } from "zod";

/**
 * Renderer-side window routing (ENGINEERING_SPEC §2). Main opens every window
 * with `?window=<kind>&projectId=..&displayId=..`; this parses it back.
 * Unknown or invalid input always falls back to the launcher.
 *
 * Kept in sync with `electron/windows/windowKinds.ts` (asserted by a test).
 */
export const ROUTER_WINDOW_KINDS = [
  "launcher",
  "editor",
  "settings",
  "hud",
  "region-overlay",
  "countdown",
  "webcam-bubble",
] as const;

export type RouteKind = (typeof ROUTER_WINDOW_KINDS)[number];

const id = z.string().trim().min(1).max(256);

const RouteSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("launcher") }),
  z.object({ kind: z.literal("editor"), projectId: id }),
  z.object({ kind: z.literal("settings") }),
  z.object({ kind: z.literal("hud"), displayId: id.optional() }),
  z.object({ kind: z.literal("region-overlay"), displayId: id }),
  z.object({ kind: z.literal("countdown"), displayId: id.optional() }),
  z.object({ kind: z.literal("webcam-bubble") }),
]);

export type WindowRoute = z.infer<typeof RouteSchema>;
export type RouteOf<K extends RouteKind> = Extract<WindowRoute, { kind: K }>;

export const LAUNCHER_ROUTE: WindowRoute = { kind: "launcher" };

/** Parse `location.search` (with or without the leading `?`). */
export function parseWindowRoute(search: string): WindowRoute {
  const sp = new URLSearchParams(search);
  const candidate: Record<string, string> = {};
  const kind = sp.get("window");
  if (kind !== null) candidate.kind = kind;
  const projectId = sp.get("projectId");
  if (projectId) candidate.projectId = projectId;
  const displayId = sp.get("displayId");
  if (displayId) candidate.displayId = displayId;
  const parsed = RouteSchema.safeParse(candidate);
  if (!parsed.success) return LAUNCHER_ROUTE;
  // Strip keys that don't belong to the kind (zod objects already strip unknowns).
  return parsed.data;
}

/** Transparent overlay windows need a transparent document background. */
export function isTransparentKind(kind: RouteKind): boolean {
  return (
    kind === "hud" || kind === "region-overlay" || kind === "countdown" || kind === "webcam-bubble"
  );
}
