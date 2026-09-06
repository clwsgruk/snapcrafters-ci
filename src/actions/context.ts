import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { InputError } from "../runtime/errors.js";
import { positiveDecimal, repository } from "./inputs.js";

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
  const eventPath = env.GITHUB_EVENT_PATH;
  if (
    !env.GITHUB_WORKSPACE ||
    !env.GITHUB_REPOSITORY ||
    !env.GITHUB_RUN_ID ||
    !env.GITHUB_SHA ||
    !eventPath
  ) {
    throw new InputError("Incomplete GitHub Actions context");
  }
  if (!isAbsolute(env.GITHUB_WORKSPACE) || !isAbsolute(eventPath))
    throw new InputError("GitHub workspace and event paths must be absolute");
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_SERVER_URL !== "https://github.com" ||
    env.RUNNER_ENVIRONMENT !== "github-hosted" ||
    env.RUNNER_OS !== "Linux" ||
    !new Set(["ubuntu22", "ubuntu24"]).has(env.ImageOS ?? "") ||
    nodeVersion.split(".")[0] !== "24"
  ) {
    throw new InputError("Unsupported GitHub Actions runner capability");
  }
  repository(env.GITHUB_REPOSITORY);
  positiveDecimal(env.GITHUB_RUN_ID, "GITHUB_RUN_ID");
  if (!/^[0-9a-f]{40}$/.test(env.GITHUB_SHA)) throw new InputError("Invalid GITHUB_SHA");
  if (!/^[A-Za-z0-9_]+$/.test(env.GITHUB_EVENT_NAME ?? ""))
    throw new InputError("Invalid GITHUB_EVENT_NAME");
  const bytes = await readBoundedEvent(eventPath);
  const event = JSON.parse(bytes.toString("utf8")) as unknown;
  if (!event || typeof event !== "object" || Array.isArray(event))
    throw new InputError("Event payload must be an object");
  return {
    workspace: env.GITHUB_WORKSPACE,
    repository: env.GITHUB_REPOSITORY,
    runId: env.GITHUB_RUN_ID,
    sha: env.GITHUB_SHA,
    eventName: env.GITHUB_EVENT_NAME ?? "",
    event: event as Record<string, unknown>,
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
