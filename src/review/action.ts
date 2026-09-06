import { boolean, optional, required } from "../actions/inputs.js";
import { actionSignal } from "../actions/signal.js";
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
  const cancellation = actionSignal();
  try {
    const snap = required(env, "snap");
    await runReview({ snap, classic: false }, process.cwd(), cancellation.signal);
    if (boolean(optional(env, "install", "false"), "install")) {
      const result = await runProcess({
        file: "sudo",
        args: ["snap", "install", "--classic", "--dangerous", snap],
        cwd: process.cwd(),
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
