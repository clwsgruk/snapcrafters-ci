import * as core from "@actions/core";
import { runPromotionAction } from "../src/promotion/action.js";

export async function main(): Promise<void> {
  await runPromotionAction(process.env);
}

if (process.env.NODE_ENV !== "test") {
  void main().catch((error: unknown) =>
    core.setFailed(error instanceof Error ? error : String(error)),
  );
}
