import * as core from "@actions/core";
import { runParseAction } from "../src/project/action.js";

export async function main(): Promise<void> {
  await runParseAction(process.env);
}

export function fail(error: unknown): void {
  core.setFailed(error instanceof Error ? error : String(error));
}
