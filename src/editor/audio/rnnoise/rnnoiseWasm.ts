import { type DenoiseFrame, RNNOISE_FRAME_SIZE } from "./framer";

/**
 * Minimal binding to the `@jitsi/rnnoise-wasm` binary without its emscripten
 * glue (the glue reads `import.meta.url`/`document`, which an AudioWorklet
 * global scope doesn't have). The binary's minified interface:
 *
 *   imports  a.a = emscripten_resize_heap(requestedSize)
 *            a.b = emscripten_memcpy_big(dest, src, num)
 *   exports  c memory · d __wasm_call_ctors · e rnnoise_init
 *            f rnnoise_create(model) · g malloc · h rnnoise_destroy(state) · i free
 *            j rnnoise_process_frame(state, out, in) → voice probability
 *
 * (Mapping of `dist/rnnoise.wasm` from its async glue `dist/rnnoise.js`; the
 * sync glue embeds a differently minified build.)
 *
 * Compiles synchronously, so it must run off the main thread (worklet/worker)
 * or in tests.
 */

interface RnnoiseExports {
  c: WebAssembly.Memory;
  d: () => void;
  f: (model: number) => number;
  g: (bytes: number) => number;
  h: (state: number) => void;
  i: (ptr: number) => void;
  j: (state: number, out: number, input: number) => number;
}

const WASM_PAGE = 65_536;
const MAX_HEAP = 2_147_483_648;

export interface RnnoiseDenoiser {
  denoise: DenoiseFrame;
  destroy(): void;
}

export function createRnnoiseDenoiser(wasmBytes: BufferSource): RnnoiseDenoiser {
  let memory: WebAssembly.Memory | null = null;
  const imports = {
    a: {
      a: (requested: number): number => {
        if (!memory) return 0;
        const size = requested >>> 0;
        if (size > MAX_HEAP) return 0;
        const pages = Math.ceil((size - memory.buffer.byteLength) / WASM_PAGE);
        if (pages <= 0) return 1;
        try {
          memory.grow(pages);
          return 1;
        } catch {
          return 0;
        }
      },
      b: (dest: number, src: number, num: number): void => {
        if (memory) new Uint8Array(memory.buffer).copyWithin(dest, src, src + num);
      },
    },
  };
  const instance = new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), imports);
  const ex = instance.exports as unknown as RnnoiseExports;
  memory = ex.c;
  ex.d();
  const state = ex.f(0);
  const ptr = ex.g(RNNOISE_FRAME_SIZE * Float32Array.BYTES_PER_ELEMENT);
  if (!state || !ptr) throw new Error("RNNoise failed to initialize");
  let alive = true;

  return {
    denoise(frame) {
      if (!alive || !memory) return 0;
      // Views are rebuilt per frame: a heap grow detaches old buffers.
      const heap = new Float32Array(memory.buffer, ptr, RNNOISE_FRAME_SIZE);
      heap.set(frame.subarray(0, RNNOISE_FRAME_SIZE));
      const vad = ex.j(state, ptr, ptr);
      frame.set(new Float32Array(memory.buffer, ptr, RNNOISE_FRAME_SIZE));
      return vad;
    },
    destroy() {
      if (!alive) return;
      alive = false;
      ex.i(ptr);
      ex.h(state);
    },
  };
}
