import { open } from "node:fs/promises";
import { InputError } from "../runtime/errors.js";
import { parseEventPayload, validateContextEnvironment } from "./context-validation.js";

export interface ActionContext {
  workspace: string;
  repository: string;
  runId: string;
  sha: string;
  eventName: string;
  event: Record<string, unknown>;
}

export async function actionContext(
  env: NodeJS.ProcessEnv,
  nodeVersion = process.versions.node,
): Promise<ActionContext> {
  const validated = validateContextEnvironment(env, nodeVersion);
  const event = parseEventPayload(await readBoundedEvent(validated.eventPath));
  return {
    workspace: validated.workspace,
    repository: validated.repository,
    runId: validated.runId,
    sha: validated.sha,
    eventName: validated.eventName,
    event,
  };
}

async function readBoundedEvent(path: string): Promise<Buffer> {
  const limit = 2 * 1024 * 1024;
  const handle = await open(path, "r");
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new InputError("Event payload must be a regular file");
    if (metadata.size > limit) throw new InputError("Event payload exceeds size limit");
    const buffer = Buffer.alloc(Math.min(metadata.size + 1, limit + 1));
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > limit) throw new InputError("Event payload exceeds size limit");
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}
