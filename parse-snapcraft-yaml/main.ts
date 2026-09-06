import * as core from "@actions/core";
import { runParseAction } from "../src/project/action.js";

export async function main(): Promise<void> {
  await runParseAction(process.env);
}

if (process.env.NODE_ENV !== "test") {
  void main().catch((error: unknown) =>
    core.setFailed(error instanceof Error ? error : String(error)),
  );
}
