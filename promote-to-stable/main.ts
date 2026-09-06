import * as core from "@actions/core";
import { runPromotionAction } from "../src/promotion/action.js";

export async function main(): Promise<void> {
  await runPromotionAction(process.env);
}

export function fail(error: unknown): void {
  core.setFailed(error instanceof Error ? error : String(error));
}
