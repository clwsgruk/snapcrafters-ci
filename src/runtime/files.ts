import { lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export async function confinedPath(root: string, candidate: string): Promise<string> {
  if (isAbsolute(candidate)) throw new Error("Absolute paths are not allowed");
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, candidate);
  const rel = relative(absoluteRoot, target);
  if (rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("Path traversal is not allowed");

  let current = absoluteRoot;
  for (const part of rel.split(sep).slice(0, -1)) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error("Symlink path is not allowed");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return target;
}

export async function resolveProjectRoot(workspace: string, input: string): Promise<string> {
  const workspaceReal = await realpath(workspace);
  const requested = resolve(workspaceReal, input || ".");
  const requestedReal = await realpath(requested);
  const rel = relative(workspaceReal, requestedReal);
  if (rel === ".." || rel.startsWith(`..${sep}`))
    throw new Error("Project root escapes workspace");
  return requestedReal;
}

export async function ownedTemp(parent: string, prefix: string, owner: string): Promise<string> {
  const { writeFile } = await import("node:fs/promises");
  const directory = await mkdtemp(join(parent, prefix));
  await writeFile(join(directory, ".owner"), owner, { mode: 0o600 });
  return directory;
}

export async function removeOwned(directory: string, owner: string): Promise<void> {
  const marker = await readFile(join(directory, ".owner"), "utf8");
  if (marker !== owner) throw new Error("Refusing to remove resource not owned by this run");
  await rm(directory, { recursive: true });
}
