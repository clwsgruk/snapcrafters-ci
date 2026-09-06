import { actionContext } from "../actions/context.js";
import { actionSignal } from "../actions/signal.js";
import { runProcess } from "../runtime/process.js";

export async function runGhvmctlSetupAction(): Promise<void> {
  await actionContext(process.env);
  const cancellation = actionSignal();
  try {
    for (const args of [
      ["snap", "install", "ghvmctl"],
      ["snap", "connect", "ghvmctl:lxd", "lxd:lxd"],
    ]) {
      const result = await runProcess({
        file: "sudo",
        args,
        cwd: process.cwd(),
        env: { PATH: process.env.PATH ?? "" },
        timeoutMs: 5 * 60_000,
        signal: cancellation.signal,
      });
      if (result.exitCode !== 0) throw new Error(`ghvmctl setup failed (${result.exitCode})`);
    }
  } finally {
    cancellation.dispose();
  }
}
