import * as core from "@actions/core";
import { runFetchManifestsAction } from "../src/manifests/action.js";

export async function main(): Promise<void> {
  await runFetchManifestsAction(process.env);
}

export function fail(error: unknown): void {
  core.setFailed(error instanceof Error ? error : String(error));
}
