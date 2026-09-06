import { readFile } from "node:fs/promises";
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

export async function actionContext(env: NodeJS.ProcessEnv): Promise<ActionContext> {
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
  repository(env.GITHUB_REPOSITORY);
  positiveDecimal(env.GITHUB_RUN_ID, "GITHUB_RUN_ID");
  if (!/^[0-9a-f]{40}$/.test(env.GITHUB_SHA)) throw new InputError("Invalid GITHUB_SHA");
  if (env.GITHUB_EVENT_NAME?.includes("\n")) throw new InputError("Invalid GITHUB_EVENT_NAME");
  const bytes = await readFile(eventPath);
  if (bytes.length > 2 * 1024 * 1024) throw new InputError("Event payload exceeds size limit");
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
