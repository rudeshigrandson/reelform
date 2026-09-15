import { type ReactNode, useEffect, useMemo } from "react";
import {
  type RouteKind,
  type RouteOf,
  type WindowRoute,
  isTransparentKind,
  parseWindowRoute,
} from "./windowRoute";

/**
 * Maps the window kind to a screen. Screens are supplied by the caller, so
 * this module never imports them. A kind without a renderer falls back to the
 * launcher renderer.
 */
export type WindowRenderers = {
  launcher: (route: RouteOf<"launcher">) => ReactNode;
} & {
  [K in Exclude<RouteKind, "launcher">]?: ((route: RouteOf<K>) => ReactNode) | undefined;
};

export interface WindowRootProps {
  renderers: WindowRenderers;
  /** Defaults to `window.location.search`. */
  search?: string | undefined;
}

function renderRoute(
  route: WindowRoute,
  renderers: WindowRenderers,
): { kind: RouteKind; node: ReactNode } {
  // Each case narrows `route` so the renderer receives its exact params.
  switch (route.kind) {
    case "editor":
      if (renderers.editor) return { kind: route.kind, node: renderers.editor(route) };
      break;
    case "settings":
      if (renderers.settings) return { kind: route.kind, node: renderers.settings(route) };
      break;
    case "hud":
      if (renderers.hud) return { kind: route.kind, node: renderers.hud(route) };
      break;
    case "region-overlay":
      if (renderers["region-overlay"])
        return { kind: route.kind, node: renderers["region-overlay"](route) };
      break;
    case "countdown":
      if (renderers.countdown) return { kind: route.kind, node: renderers.countdown(route) };
      break;
    case "webcam-bubble":
      if (renderers["webcam-bubble"])
        return { kind: route.kind, node: renderers["webcam-bubble"](route) };
      break;
    default:
      break;
  }
  return { kind: "launcher", node: renderers.launcher({ kind: "launcher" }) };
}

export function WindowRoot({ renderers, search }: WindowRootProps) {
  const effectiveSearch = search ?? (typeof window === "undefined" ? "" : window.location.search);
  const route = useMemo(() => parseWindowRoute(effectiveSearch), [effectiveSearch]);
  const { kind, node } = renderRoute(route, renderers);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.window = kind;
    const prev = document.body.style.background;
    if (isTransparentKind(kind)) document.body.style.background = "transparent";
    return () => {
      delete root.dataset.window;
      document.body.style.background = prev;
    };
  }, [kind]);

  return <>{node}</>;
}
