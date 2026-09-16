import type { ReelformApi } from "@contracts";

declare global {
  interface Window {
    reelform: ReelformApi;
  }
}
