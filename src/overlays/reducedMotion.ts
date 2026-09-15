import { useEffect, useState } from "react";

/**
 * Reduce motion (guide S24 a11y): the OS preference
 * (`prefers-reduced-motion: reduce`) or the in-app setting, which the
 * appearance layer stamps on the root as `data-reduce-motion="true"`.
 * Components use it to swap pulses / spins / transitions for a static or
 * fade fallback.
 */

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export interface MotionEnv {
  matchMedia?: ((query: string) => { matches: boolean }) | undefined;
  root?: { dataset: DOMStringMap } | null | undefined;
}

function defaultEnv(): MotionEnv {
  return {
    matchMedia:
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? (q) => window.matchMedia(q)
        : undefined,
    root: typeof document === "undefined" ? null : document.documentElement,
  };
}

export function prefersReducedMotion(env: MotionEnv = defaultEnv()): boolean {
  if (env.root?.dataset.reduceMotion === "true") return true;
  try {
    return env.matchMedia?.(REDUCED_MOTION_QUERY).matches === true;
  } catch {
    return false;
  }
}

/** {@link prefersReducedMotion}, kept current when the OS preference or the setting changes. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => prefersReducedMotion());
  useEffect(() => {
    const update = () => setReduced(prefersReducedMotion());
    update();
    const cleanups: Array<() => void> = [];
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      const mql = window.matchMedia(REDUCED_MOTION_QUERY);
      if (typeof mql.addEventListener === "function") {
        mql.addEventListener("change", update);
        cleanups.push(() => mql.removeEventListener("change", update));
      }
    }
    if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
      const observer = new MutationObserver(update);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-reduce-motion"],
      });
      cleanups.push(() => observer.disconnect());
    }
    return () => {
      for (const c of cleanups) c();
    };
  }, []);
  return reduced;
}
