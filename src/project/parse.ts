import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { resolve } from "node:path";
import { InputError } from "../runtime/errors.js";
import { resolveProjectRoot } from "../runtime/files.js";
import { parseProjectDocument } from "./schema.js";
import type { Project } from "./types.js";

const candidates = [
  ".snapcraft.yaml",
  "build-aux/snap/snapcraft.yaml",
  "snap/snapcraft.yaml",
  "snapcraft.yaml",
];

async function regularFile(path: string, label: string): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) throw new InputError(`${label} must not be a symlink`);
    if (!metadata.isFile()) throw new InputError(`${label} must be a regular file`);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return false;
  }
}

export async function parseProject(workspace: string, inputRoot = ""): Promise<Project> {
  const publicRoot = inputRoot || ".";
  const root = await resolveProjectRoot(workspace, publicRoot);
  const matches: string[] = [];
  for (const candidate of candidates)
    if (await regularFile(resolve(root, candidate), "snapcraft.yaml")) matches.push(candidate);
  const selected = matches.at(-1);
  if (!selected) throw new InputError("No snapcraft.yaml found");
  const yamlPath = resolve(root, selected);
  const bytes = await readBoundedRegular(yamlPath, 2 * 1024 * 1024, "snapcraft.yaml");
  const parsed = parseProjectDocument(bytes);
  const plugsFile = await declaration(workspace, [
    "plug-declaration.json",
    ".github/plug-declaration.json",
  ]);
  const slotsFile = await declaration(workspace, [
    "slot-declaration.json",
    ".github/slot-declaration.json",
  ]);
  return {
    root,
    yamlPath,
    publicRoot,
    publicYamlPath: `${publicRoot.replace(/\/$/, "")}/${selected}`,
    ...parsed,
    ...(plugsFile ? { plugsFile } : {}),
    ...(slotsFile ? { slotsFile } : {}),
  };
}

async function declaration(workspace: string, paths: string[]): Promise<string | undefined> {
  let found: string | undefined;
  for (const path of paths)
    if (await regularFile(resolve(workspace, path), "declaration file")) {
      const metadata = await lstat(resolve(workspace, path));
      if (metadata.size > 1024 * 1024)
        throw new InputError("Declaration file exceeds 1 MiB limit");
      found = path;
    }
  return found;
}

async function readBoundedRegular(path: string, limit: number, label: string): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new InputError(`${label} must be a regular file`);
    if (metadata.size > limit) throw new InputError(`${label} exceeds 2 MiB limit`);
    const buffer = Buffer.alloc(Math.min(metadata.size + 1, limit + 1));
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > limit) throw new InputError(`${label} exceeds 2 MiB limit`);
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}
