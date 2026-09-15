import { useEffect, useState } from "react";
import type { DecodedAudio, InspectorHost } from "./types";

/**
 * Decoded-audio cache shared by the Audio, Webcam and Effects tabs so switching
 * tabs doesn't re-decode the same file. Keyed per host so test fakes stay isolated.
 */

const caches = new WeakMap<InspectorHost, Map<string, Promise<DecodedAudio | null>>>();

export function decodeCached(host: InspectorHost, url: string): Promise<DecodedAudio | null> {
  let cache = caches.get(host);
  if (!cache) {
    cache = new Map();
    caches.set(host, cache);
  }
  let p = cache.get(url);
  if (!p) {
    p = host.decodeAudio(url).catch(() => null);
    cache.set(url, p);
  }
  return p;
}

export type AsyncAudio =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; audio: DecodedAudio }
  | { state: "unavailable" };

/** Decode `url` (null → idle). Resolves to "unavailable" when decoding fails. */
export function useDecodedAudio(host: InspectorHost, url: string | null): AsyncAudio {
  const [result, setResult] = useState<AsyncAudio>(url ? { state: "loading" } : { state: "idle" });
  useEffect(() => {
    if (!url) {
      setResult({ state: "idle" });
      return;
    }
    let live = true;
    setResult({ state: "loading" });
    void decodeCached(host, url).then((audio) => {
      if (!live) return;
      setResult(audio ? { state: "ready", audio } : { state: "unavailable" });
    });
    return () => {
      live = false;
    };
  }, [host, url]);
  return result;
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

let seq = 0;
/** Unique-enough ids for items created by host actions. */
export function hostId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}
