import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parse } from "yaml";
import { actions } from "./actions.js";

const execFile = promisify(execFileCallback);
const temporary = await mkdtemp(join(tmpdir(), "snapcrafters-shellcheck-"));
try {
  const scripts: string[] = [];
  for (const action of actions) {
    const metadata = parse(await readFile(`${action}/action.yaml`, "utf8")) as {
      runs?: { steps?: Array<{ shell?: string; run?: string }> };
    };
    for (const [index, step] of (metadata.runs?.steps ?? []).entries()) {
      if (step.shell === "bash" && typeof step.run === "string") {
        const path = join(temporary, `${action}-${index}.bash`);
        const source = step.run.replaceAll(/\$\{\{[^}]+\}\}/g, "/tmp/action-expression");
        await writeFile(path, `#!/usr/bin/env bash\n${source}\n`);
        scripts.push(path);
      }
    }
  }
  if (!scripts.length) throw new Error("No inline Bash wrapper steps found");
  await execFile("shellcheck", ["get-screenshots/wait-for-window", ...scripts]);
  console.log(`ShellCheck passed for the helper and ${scripts.length} inline Bash steps`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
