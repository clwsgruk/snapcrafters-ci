import * as core from "@actions/core";
import { runArchitecturesAction } from "../src/project/action.js";

export async function main(): Promise<void> {
  if (process.env.SNAPCRAFTERS_CI_SMOKE === "1") return;
  await runArchitecturesAction(process.env);
}

if (process.env.NODE_ENV !== "test") {
  void main().catch((error: unknown) =>
    core.setFailed(error instanceof Error ? error : String(error)),
  );
}
