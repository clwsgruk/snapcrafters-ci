import * as core from "@actions/core";
import { actionContext } from "../actions/context.js";
import { channel, optional, required } from "../actions/inputs.js";
import { actionSignal } from "../actions/signal.js";
import { parseProject } from "../project/parse.js";
import { promotionGitHub } from "../runtime/github.js";
import { runProcess } from "../runtime/process.js";
import { promote } from "./run.js";

export async function runPromotionAction(env: NodeJS.ProcessEnv): Promise<void> {
  const githubToken = required(env, "github-token", 4_096);
  const storeToken = required(env, "store-token", 16_384);
  core.setSecret(githubToken);
  core.setSecret(storeToken);
  const context = await actionContext(env);
  const event = context.event as {
    action?: string;
    comment?: { body?: string; user?: { login?: string } };
    issue?: { number?: number; pull_request?: unknown };
  };
  if (event.issue?.pull_request) throw new Error("Promotion is not available on pull requests");
  const issue = event.issue?.number;
  const actor = event.comment?.user?.login;
  if (!Number.isSafeInteger(issue) || !issue || !actor || actor.includes("\n"))
    throw new Error("Incomplete issue comment event");
  const project = await parseProject(context.workspace, optional(env, "snapcraft-project-root"));
  const cancellation = actionSignal();
  try {
    const github = promotionGitHub(githubToken, context.repository, issue, cancellation.signal);
    await promote(
      {
        eventName: context.eventName,
        action: event.action ?? "",
        repository: context.repository,
        issue,
        actor,
        comment: event.comment?.body ?? "",
        configuredChannel: channel(optional(env, "channel", "latest/stable")),
      },
      {
        ...github,
        release: async (revision, destination) => {
          const result = await runProcess({
            file: "snapcraft",
            args: ["release", project.name, revision, destination],
            cwd: context.workspace,
            env: { PATH: process.env.PATH ?? "", SNAPCRAFT_STORE_CREDENTIALS: storeToken },
            timeoutMs: 10 * 60_000,
            signal: cancellation.signal,
            redact: [storeToken],
          });
          if (result.exitCode !== 0) throw new Error(`Store release failed (${result.exitCode})`);
        },
      },
    );
  } finally {
    cancellation.dispose();
  }
}
