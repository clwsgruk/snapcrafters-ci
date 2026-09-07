import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

export function validateRunner(env = process.env, node = process.version) {
  if (
    env.GITHUB_SERVER_URL !== "https://github.com" ||
    env.RUNNER_ENVIRONMENT !== "github-hosted" ||
    env.RUNNER_OS !== "Linux" ||
    !["ubuntu22", "ubuntu24"].includes(env.ImageOS || "") ||
    !node.startsWith("v24.")
  ) {
    throw Error("Requires github.com-hosted Ubuntu 22.04/24.04 and Node 24");
  }
}

export const input = (name: string) =>
  process.env[`INPUT_${name.toUpperCase().replaceAll("-", "_")}`] || "";

export function outputs(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    const delimiter = randomUUID();
    appendFileSync(process.env.GITHUB_OUTPUT!, `${key}<<${delimiter}\n${value}\n${delimiter}\n`);
  }
}

export async function main(action: () => unknown) {
  try {
    validateRunner();
    if (process.env.CI_PHASE !== "validate") {
      await action();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Action failed");
    process.exitCode = 1;
  }
}
