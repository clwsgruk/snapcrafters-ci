import * as core from "@actions/core";
import { runUpdateAction } from "../src/update/action.js";

export async function main(): Promise<void> {
  await runUpdateAction(process.env);
}

export function fail(error: unknown): void {
  core.setFailed(error instanceof Error ? error : String(error));
}
