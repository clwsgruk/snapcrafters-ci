import { isAbsolute } from "node:path";
import { InputError } from "../runtime/errors.js";
import { positiveDecimal, repository } from "./inputs.js";

export interface ValidatedContextEnvironment {
  workspace: string;
  repository: string;
  runId: string;
  sha: string;
  eventName: string;
  eventPath: string;
}

export function validateContextEnvironment(
  env: NodeJS.ProcessEnv,
  nodeVersion: string,
): ValidatedContextEnvironment {
  const eventPath = env.GITHUB_EVENT_PATH;
  if (
    !env.GITHUB_WORKSPACE ||
    !env.GITHUB_REPOSITORY ||
    !env.GITHUB_RUN_ID ||
    !env.GITHUB_SHA ||
    !eventPath
  )
    throw new InputError("Incomplete GitHub Actions context");
  if (!isAbsolute(env.GITHUB_WORKSPACE) || !isAbsolute(eventPath))
    throw new InputError("GitHub workspace and event paths must be absolute");
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_SERVER_URL !== "https://github.com" ||
    env.RUNNER_ENVIRONMENT !== "github-hosted" ||
    env.RUNNER_OS !== "Linux" ||
    !new Set(["ubuntu22", "ubuntu24"]).has(env.ImageOS ?? "") ||
    nodeVersion.split(".")[0] !== "24"
  )
    throw new InputError("Unsupported GitHub Actions runner capability");
  repository(env.GITHUB_REPOSITORY);
  positiveDecimal(env.GITHUB_RUN_ID, "GITHUB_RUN_ID");
  if (!/^[0-9a-f]{40}$/.test(env.GITHUB_SHA)) throw new InputError("Invalid GITHUB_SHA");
  if (!/^[A-Za-z0-9_]+$/.test(env.GITHUB_EVENT_NAME ?? ""))
    throw new InputError("Invalid GITHUB_EVENT_NAME");
  return {
    workspace: env.GITHUB_WORKSPACE,
    repository: env.GITHUB_REPOSITORY,
    runId: env.GITHUB_RUN_ID,
    sha: env.GITHUB_SHA,
    eventName: env.GITHUB_EVENT_NAME ?? "",
    eventPath,
  };
}

export function parseEventPayload(bytes: Buffer): Record<string, unknown> {
  const event = JSON.parse(bytes.toString("utf8")) as unknown;
  if (!event || typeof event !== "object" || Array.isArray(event))
    throw new InputError("Event payload must be an object");
  return event as Record<string, unknown>;
}
