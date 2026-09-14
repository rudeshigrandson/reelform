import { type IpcMainInvokeEvent, ipcMain } from "electron";
import { type ChannelName, type Contracts, contracts, type RequestOf, type ResponseOf } from "./contracts";

/**
 * Register a handler for a contract channel. The request payload is
 * zod-validated before the handler runs and the response is validated before
 * it goes back to the renderer, so a contract mismatch fails loudly in dev.
 */
export function handle<K extends ChannelName>(
  name: K,
  handler: (payload: RequestOf<K>, event: IpcMainInvokeEvent) => Promise<ResponseOf<K>> | ResponseOf<K>,
): void {
  const contract: Contracts[K] = contracts[name];
  ipcMain.handle(name, async (event, raw) => {
    const req = contract.request.parse(raw);
    const res = await handler(req as RequestOf<K>, event);
    return contract.response.parse(res);
  });
}
