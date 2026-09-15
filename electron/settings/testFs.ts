import type { SettingsFs } from "./store";

/** In-memory fs for settings tests; records every call and can inject failures. */
export class MemoryFs implements SettingsFs {
  files = new Map<string, string>();
  calls: string[] = [];
  failWrite: Error | null = null;

  async readFile(path: string): Promise<string> {
    this.calls.push(`read ${path}`);
    const v = this.files.get(path);
    if (v === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return v;
  }

  async writeFile(path: string, data: string): Promise<void> {
    this.calls.push(`write ${path}`);
    if (this.failWrite) throw this.failWrite;
    this.files.set(path, data);
  }

  async rename(from: string, to: string): Promise<void> {
    this.calls.push(`rename ${from} -> ${to}`);
    const v = this.files.get(from);
    if (v === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    this.files.delete(from);
    this.files.set(to, v);
  }

  async mkdir(path: string): Promise<void> {
    this.calls.push(`mkdir ${path}`);
  }

  json(path: string): unknown {
    const v = this.files.get(path);
    return v === undefined ? undefined : JSON.parse(v);
  }
}
