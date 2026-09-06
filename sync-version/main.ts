import { syncVersion } from "../src/execution.ts";
import { input, main } from "../src/runtime.ts";
void main(() =>
  syncVersion(
    input("update-script"),
    input("snapcraft-project-root"),
    input("bot-name"),
    input("bot-email"),
  ),
);
