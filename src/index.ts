import { registerAdapter } from "./adapter.js";
import { browserAdapter } from "./browser.js";
import { commandAdapter } from "./command.js";
import { fileAdapter } from "./file.js";
import { httpAdapter } from "./http.js";
import { jsonAdapter } from "./json.js";

registerAdapter(browserAdapter);
registerAdapter(httpAdapter);
registerAdapter(jsonAdapter);
registerAdapter(commandAdapter);
registerAdapter(fileAdapter);

export { adapterKinds, getAdapter, registerAdapter } from "./adapter.js";
export type { Adapter, RunContext } from "./adapter.js";
export type * from "./model.js";
export { capture } from "./capture.js";
export { parseCaptureContract, parseContract } from "./schema.js";
export { verify } from "./verify.js";
export { inspectReceipt } from "./receipt.js";
