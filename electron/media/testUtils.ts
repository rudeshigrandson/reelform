import { EventEmitter } from "node:events";
import type { ChildLike, SpawnFn } from "./runner";

/**
 * Shared test fakes for the media domain (fake child process, scripted spawn).
 * Test-only; not re-exported from the barrel.
 */

export class FakeChild extends EventEmitter implements ChildLike {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly kills: (string | undefined)[] = [];

  kill(signal?: NodeJS.Signals | undefined): boolean {
    this.kills.push(signal);
    return true;
  }

  out(chunk: string | Uint8Array): this {
    this.stdout.emit("data", chunk);
    return this;
  }

  err(chunk: string): this {
    this.stderr.emit("data", chunk);
    return this;
  }

  close(code: number | null, signal: string | null = null): void {
    this.emit("close", code, signal);
  }
}

export interface SpawnCall {
  command: string;
  args: readonly string[];
  child: FakeChild;
}

/** Spawn that hands each call to `script` (sync or on a microtask) and records it. */
export function scriptedSpawn(script: (call: SpawnCall) => void): {
  spawn: SpawnFn;
  calls: SpawnCall[];
} {
  const calls: SpawnCall[] = [];
  const spawn: SpawnFn = (command, args) => {
    const child = new FakeChild();
    const call = { command, args, child };
    calls.push(call);
    queueMicrotask(() => script(call));
    return child;
  };
  return { spawn, calls };
}
