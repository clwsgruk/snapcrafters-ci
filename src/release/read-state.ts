import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { InputError } from "../runtime/errors.js";
import type { Published } from "./types.js";
import { parseReleaseState, stateLimit } from "./state.js";

export async function readReleaseState(path: string): Promise<Published> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new InputError("Release state must be a regular file");
    if (metadata.size > stateLimit) throw new InputError("Release state exceeds size limit");
    const buffer = Buffer.alloc(Math.min(metadata.size + 1, stateLimit + 1));
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > stateLimit) throw new InputError("Release state exceeds size limit");
    return parseReleaseState(buffer.subarray(0, offset).toString("utf8"));
  } finally {
    await handle.close();
  }
}
