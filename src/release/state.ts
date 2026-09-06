import { architecture, channel } from "../actions/inputs.js";
import { InputError } from "../runtime/errors.js";
import type { Published } from "./types.js";

export const stateLimit = 4_096;

export function parseReleaseState(source: string): Published {
  if (Buffer.byteLength(source) > stateLimit)
    throw new InputError("Release state exceeds size limit");
  const value = JSON.parse(source) as Record<string, unknown>;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.snap !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,39}$/.test(value.snap) ||
    typeof value.version !== "string" ||
    !value.version ||
    value.version.includes("\n") ||
    typeof value.revision !== "string" ||
    !/^[1-9][0-9]*$/.test(value.revision) ||
    typeof value.channel !== "string" ||
    typeof value.architecture !== "string" ||
    typeof value.digest !== "string" ||
    !/^[0-9a-f]{96}$/.test(value.digest) ||
    typeof value.sourceSha !== "string" ||
    !/^[0-9a-f]{40}$/.test(value.sourceSha)
  )
    throw new InputError("Invalid release state");
  architecture(value.architecture);
  channel(value.channel);
  return value as unknown as Published;
}
