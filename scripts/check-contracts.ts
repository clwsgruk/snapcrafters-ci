import { access } from "node:fs/promises";
import { resolve } from "node:path";

const actions = [
  "call-for-testing",
  "fetch-manifests",
  "get-architectures",
  "get-screenshots",
  "parse-snapcraft-yaml",
  "promote-to-stable",
  "release-to-candidate",
  "review-snap",
  "run-tests",
  "setup-ghvmctl",
  "sync-version",
  "test-snap-build",
];

await Promise.all(
  actions.flatMap((action) =>
    ["action.yaml", "README.md", "main.ts", "main.test.ts"].map((file) =>
      access(resolve(action, file)),
    ),
  ),
);
console.log(`Validated ${actions.length} action boundaries`);
