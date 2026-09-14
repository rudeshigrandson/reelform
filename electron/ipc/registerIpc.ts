import { type IpcMainInvokeEvent, ipcMain } from "electron";
import {
  type ChannelName,
  type Contracts,
  type IpcError,
  type RequestOf,
  type ResponseOf,
  contracts,
} from "./contracts";
import { IPC_ERROR_PREFIX, toIpcError } from "./errors";

/**
 * Register a handler for a contract channel. The request payload is
 * zod-validated before the handler runs and the response is validated before
 * it goes back to the renderer, so a contract mismatch fails loudly in dev.
 *
 * Electron's `ipcMain.handle` keeps only an error's message, so thrown errors
 * are re-thrown with the `{ code, message, details }` IpcError JSON-encoded in
 * the message; `src/app/ipc.ts` decodes it back into a typed error.
 */
export function handle<K extends ChannelName>(
  name: K,
  handler: (
    payload: RequestOf<K>,
    event: IpcMainInvokeEvent,
  ) => Promise<ResponseOf<K>> | ResponseOf<K>,
): void {
  const contract: Contracts[K] = contracts[name];
  ipcMain.handle(name, async (event, raw) => {
    try {
      const req = contract.request.parse(raw);
      const res = await handler(req as RequestOf<K>, event);
      return contract.response.parse(res);
    } catch (err) {
      const ipcError: IpcError = toIpcError(err);
      throw new Error(`${IPC_ERROR_PREFIX}${JSON.stringify(ipcError)}`);
    }
  });
}
