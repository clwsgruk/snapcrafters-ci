import * as core from "@actions/core";
import { actionContext } from "../actions/context.js";
import { required } from "../actions/inputs.js";
import { actionSignal } from "../actions/signal.js";
import { manifestGitHub } from "../runtime/github.js";
import { collectManifests } from "./collect.js";

export async function runFetchManifestsAction(env: NodeJS.ProcessEnv): Promise<void> {
  const token = required(env, "token", 4_096);
  core.setSecret(token);
  const context = await actionContext(env);
  const cancellation = actionSignal();
  try {
    await collectManifests(
      manifestGitHub(token, context.repository, context.runId, cancellation.signal),
      context.workspace,
    );
  } finally {
    cancellation.dispose();
  }
}
