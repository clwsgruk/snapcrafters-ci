import * as core from "@actions/core";
import { runScreenshotsAction } from "../src/screenshots/action.js";

export async function main(): Promise<void> {
  await runScreenshotsAction(process.env);
}

if (process.env.NODE_ENV !== "test") {
  void main().catch((error: unknown) =>
    core.setFailed(error instanceof Error ? error : String(error)),
  );
}
