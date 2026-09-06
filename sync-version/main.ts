import * as core from "@actions/core";
import { runUpdateAction } from "../src/update/action.js";

export async function main(): Promise<void> {
  await runUpdateAction(process.env);
}

if (process.env.NODE_ENV !== "test") {
  void main().catch((error: unknown) =>
    core.setFailed(error instanceof Error ? error : String(error)),
  );
}
