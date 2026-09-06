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
    comment?: {
      id?: number;
      body?: string;
      user?: { login?: string };
      created_at?: string;
      updated_at?: string;
    };
    issue?: { number?: number; pull_request?: unknown };
  };
  if (event.issue?.pull_request) throw new Error("Promotion is not available on pull requests");
  const issue = event.issue?.number;
  const actor = event.comment?.user?.login;
  const commentId = event.comment?.id;
  const createdAt = event.comment?.created_at;
  const updatedAt = event.comment?.updated_at;
  if (
    !Number.isSafeInteger(issue) ||
    !issue ||
    !Number.isSafeInteger(commentId) ||
    !commentId ||
    !actor ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(actor) ||
    !createdAt ||
    !updatedAt ||
    Number.isNaN(Date.parse(createdAt)) ||
    Number.isNaN(Date.parse(updatedAt))
  )
    throw new Error("Incomplete issue comment event");
  const project = await parseProject(context.workspace, optional(env, "snapcraft-project-root"));
  const snapcraftChannel = channel(optional(env, "snapcraft-channel", "latest/stable"));
  const cancellation = actionSignal();
  try {
    const install = await runProcess({
      file: "sudo",
      args: ["snap", "install", "snapcraft", "--classic", "--channel", snapcraftChannel],
      cwd: context.workspace,
      env: { PATH: process.env.PATH ?? "" },
      timeoutMs: 5 * 60_000,
      signal: cancellation.signal,
    });
    if (install.exitCode !== 0)
      throw new Error(`Installing Snapcraft failed (${install.exitCode})`);
    const github = promotionGitHub(
      githubToken,
      context.repository,
      issue,
      commentId,
      cancellation.signal,
    );
    await promote(
      {
        eventName: context.eventName,
        action: event.action ?? "",
        repository: context.repository,
        issue,
        actor,
        comment: event.comment?.body ?? "",
        configuredChannel: channel(optional(env, "channel", "latest/stable")),
        snap: project.name,
        edited: createdAt !== updatedAt,
        deliveryId: `${issue}:${commentId}`,
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
        isReleased: async (revision, destination) => {
          const result = await runProcess({
            file: "snapcraft",
            args: ["revisions", project.name],
            cwd: context.workspace,
            env: { PATH: process.env.PATH ?? "", SNAPCRAFT_STORE_CREDENTIALS: storeToken },
            timeoutMs: 2 * 60_000,
            signal: cancellation.signal,
            redact: [storeToken],
          });
          if (result.exitCode !== 0) throw new Error(`Store readback failed (${result.exitCode})`);
          return result.stdout.split("\n").some((line) => {
            const fields = line.trim().split(/\s{2,}/);
            return (
              fields[0] === revision &&
              fields[4]?.split(",").some((item) => item.replace(/\*$/, "") === destination)
            );
          });
        },
      },
    );
  } finally {
    cancellation.dispose();
  }
}
