import * as core from "@actions/core";
import { actionContext } from "../actions/context.js";
import { optional, required } from "../actions/inputs.js";
import { actionSignal } from "../actions/signal.js";
import { parseProject } from "../project/parse.js";
import { runUpdate } from "./run.js";

export async function runUpdateAction(env: NodeJS.ProcessEnv): Promise<void> {
  const token = required(env, "token", 4_096);
  core.setSecret(token);
  const context = await actionContext(env);
  const root = optional(env, "snapcraft-project-root");
  const before = await parseProject(context.workspace, root);
  const cancellation = actionSignal();
  try {
    await runUpdate({
      cwd: context.workspace,
      script: required(env, "update-script", 1024 * 1024),
      name: optional(env, "bot-name", "Snapcrafters Bot"),
      email: optional(env, "bot-email", "snapforge.team@gmail.com"),
      message: async () => {
        const after = await parseProject(context.workspace, root);
        return after.version && after.version !== before.version
          ? `chore: bump ${after.name} to ${after.version}`
          : `chore: bump ${after.name} dependencies`;
      },
      signal: cancellation.signal,
    });
  } finally {
    cancellation.dispose();
  }
}
