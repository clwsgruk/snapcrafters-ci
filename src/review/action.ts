import { join } from "node:path";
import { actionContext } from "../actions/context.js";
import { boolean, optional, required } from "../actions/inputs.js";
import { actionSignal } from "../actions/signal.js";
import { parseProject } from "../project/parse.js";
import { runProcess } from "../runtime/process.js";
import { runReview } from "./run.js";

export async function runReviewAction(env: NodeJS.ProcessEnv): Promise<void> {
  const cancellation = actionSignal();
  try {
    const plugs = optional(env, "plugs");
    const slots = optional(env, "slots");
    await runReview(
      {
        snap: required(env, "snap"),
        ...(plugs ? { plugs } : {}),
        ...(slots ? { slots } : {}),
        classic: optional(env, "is-classic")
          ? boolean(optional(env, "is-classic"), "is-classic")
          : false,
      },
      process.cwd(),
      cancellation.signal,
    );
  } finally {
    cancellation.dispose();
  }
}

export async function runBuildReviewAction(env: NodeJS.ProcessEnv): Promise<void> {
  return runBuildReviewActionWith(env, {
    context: actionContext,
    parse: parseProject,
    review: runReview,
    run: runProcess,
  });
}

export async function runBuildReviewActionWith(
  env: NodeJS.ProcessEnv,
  deps: {
    context: typeof actionContext;
    parse: typeof parseProject;
    review: typeof runReview;
    run: typeof runProcess;
  },
): Promise<void> {
  const context = await deps.context(env);
  const parsed = await deps.parse(context.workspace, optional(env, "snapcraft-project-root"));
  const cancellation = actionSignal();
  try {
    const snap = required(env, "snap");
    await deps.review(
      {
        snap,
        classic: parsed.classic,
        ...(parsed.plugsFile ? { plugs: join(context.workspace, parsed.plugsFile) } : {}),
        ...(parsed.slotsFile ? { slots: join(context.workspace, parsed.slotsFile) } : {}),
      },
      context.workspace,
      cancellation.signal,
    );
    if (boolean(optional(env, "install", "false"), "install")) {
      const result = await deps.run({
        file: "sudo",
        args: ["snap", "install", "--classic", "--dangerous", snap],
        cwd: context.workspace,
        env: { PATH: process.env.PATH ?? "" },
        timeoutMs: 5 * 60_000,
        signal: cancellation.signal,
      });
      if (result.exitCode !== 0) throw new Error(`Snap installation failed (${result.exitCode})`);
    }
  } finally {
    cancellation.dispose();
  }
}
