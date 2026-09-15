import { useEffect, useState } from "react";

/** Below this window width the editor uses the narrow layout (guide S12 state 14). */
export const NARROW_LAYOUT_QUERY = "(max-width: 1180px)";

type MatchMediaFn = (
  query: string,
) => Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener">;

function defaultMatchMedia(): MatchMediaFn | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? (q) => window.matchMedia(q)
    : null;
}

/**
 * `explicit` wins when given; otherwise follows {@link NARROW_LAYOUT_QUERY}.
 * Environments without `matchMedia` (jsdom) get the wide layout.
 */
export function useNarrowLayout(
  explicit: boolean | undefined,
  matchMedia: MatchMediaFn | null = defaultMatchMedia(),
): boolean {
  const [matches, setMatches] = useState(() =>
    matchMedia ? matchMedia(NARROW_LAYOUT_QUERY).matches : false,
  );
  useEffect(() => {
    if (explicit !== undefined || !matchMedia) return;
    const mql = matchMedia(NARROW_LAYOUT_QUERY);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [explicit, matchMedia]);
  return explicit ?? matches;
}
