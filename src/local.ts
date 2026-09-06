import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { command, script } from "./execution.ts";
import { project } from "./project.ts";
export async function syncVersion(
  source: string,
  root: string,
  name: string,
  email: string,
  cwd = process.cwd(),
) {
  const before = project(root, cwd);
  const result = await script(source, cwd);
  rmSync(dirname(result.script), { recursive: true });
  if (result.code) throw Error(`Update script failed with status ${result.code}`);
  const untracked = command("git", ["ls-files", "--others", "--exclude-standard", "-z"], cwd)
    .split("\0")
    .filter(Boolean);
  if (untracked.length)
    throw Error(`Untracked paths must be resolved before committing:\n${untracked.join("\n")}`);
  if (!command("git", ["status", "--porcelain", "--untracked-files=no"], cwd).trim()) return;
  const after = project(root, cwd);
  const detail =
    before.outputs.version === after.outputs.version
      ? "dependencies"
      : `to version ${after.outputs.version}`;
  command(
    "git",
    [
      "-c",
      `user.name=${name}`,
      "-c",
      `user.email=${email}`,
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-am",
      `chore: bump ${after.outputs["snap-name"]} ${detail}`,
    ],
    cwd,
  );
  command("git", ["push"], cwd);
}
