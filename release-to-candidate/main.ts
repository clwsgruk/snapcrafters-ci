import * as core from "@actions/core";
import { runReleaseAction } from "../src/release/action.js";

export async function main(): Promise<void> {
  await runReleaseAction(process.env);
}

if (process.env.NODE_ENV !== "test") {
  void main().catch((error: unknown) =>
    core.setFailed(error instanceof Error ? error : String(error)),
  );
}
