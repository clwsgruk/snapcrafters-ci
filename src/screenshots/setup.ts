import { actionContext } from "../actions/context.js";
import { actionSignal } from "../actions/signal.js";
import { runProcess } from "../runtime/process.js";

export async function runGhvmctlSetupAction(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: { context?: typeof actionContext; run?: typeof runProcess } = {},
): Promise<void> {
  await (dependencies.context ?? actionContext)(env);
  if (env.SNAPCRAFTERS_PHASE === "validate") return;
  if (env.SNAPCRAFTERS_PHASE) throw new Error("Unsupported setup-ghvmctl phase");
  const cancellation = actionSignal();
  try {
    for (const args of [
      ["snap", "install", "ghvmctl"],
      ["snap", "connect", "ghvmctl:lxd", "lxd:lxd"],
    ]) {
      const result = await (dependencies.run ?? runProcess)({
        file: "sudo",
        args,
        cwd: process.cwd(),
        env: { PATH: env.PATH ?? "" },
        timeoutMs: 5 * 60_000,
        signal: cancellation.signal,
      });
      if (result.exitCode !== 0) throw new Error(`ghvmctl setup failed (${result.exitCode})`);
    }
  } finally {
    cancellation.dispose();
  }
}
