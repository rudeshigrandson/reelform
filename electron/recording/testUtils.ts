import type { InputHook, InputHookEvents } from "./telemetry";

/** Controllable uiohook-like input hook for tests. */
export class FakeHook implements InputHook {
  private readonly listeners = new Map<keyof InputHookEvents, Set<(e: never) => void>>();

  on<K extends keyof InputHookEvents>(
    type: K,
    listener: (e: InputHookEvents[K]) => void,
  ): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    const l = listener as (e: never) => void;
    set.add(l);
    return () => set.delete(l);
  }

  emit<K extends keyof InputHookEvents>(type: K, e: InputHookEvents[K]): void {
    for (const l of this.listeners.get(type) ?? []) (l as (e: InputHookEvents[K]) => void)(e);
  }

  get listenerCount(): number {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }
}
