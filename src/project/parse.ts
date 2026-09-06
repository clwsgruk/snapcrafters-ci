import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseDocument } from "yaml";
import { InputError } from "../runtime/errors.js";
import { resolveProjectRoot } from "../runtime/files.js";
import type { Component, Project } from "./types.js";

const candidates = [
  ".snapcraft.yaml",
  "build-aux/snap/snapcraft.yaml",
  "snap/snapcraft.yaml",
  "snapcraft.yaml",
];

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function parseProject(workspace: string, inputRoot = ""): Promise<Project> {
  const publicRoot = inputRoot || ".";
  const root = await resolveProjectRoot(workspace, publicRoot);
  const matches: string[] = [];
  for (const candidate of candidates)
    if (await exists(resolve(root, candidate))) matches.push(candidate);
  const selected = matches.at(-1);
  if (!selected) throw new InputError("No snapcraft.yaml found");
  const yamlPath = resolve(root, selected);
  const bytes = await readFile(yamlPath);
  if (bytes.length > 2 * 1024 * 1024) throw new InputError("snapcraft.yaml exceeds 2 MiB limit");
  const parsed = parseDocument(bytes.toString("utf8"), { uniqueKeys: true });
  if (parsed.errors.length)
    throw new InputError(`Invalid snapcraft YAML: ${parsed.errors[0]!.message}`);
  const document = parsed.toJS() as Record<string, unknown>;
  if (typeof document.name !== "string" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(document.name)) {
    throw new InputError("Invalid snap name");
  }
  const components = parseComponents(document.components);
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
    name: document.name,
    ...(typeof document.version === "string" || typeof document.version === "number"
      ? { version: String(document.version) }
      : {}),
    ...(typeof document["adopt-info"] === "string" ? { adoptInfo: document["adopt-info"] } : {}),
    classic: document.confinement === "classic",
    ...(typeof document.base === "string" ? { base: document.base } : {}),
    components,
    ...(plugsFile ? { plugsFile } : {}),
    ...(slotsFile ? { slotsFile } : {}),
    document,
  };
}

function parseComponents(value: unknown): Component[] {
  if (value === undefined || value === null) return [];
  if (typeof value !== "object" || Array.isArray(value))
    throw new InputError("components must be a mapping");
  return Object.entries(value as Record<string, unknown>).map(([name, raw]) => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || !raw || typeof raw !== "object") {
      throw new InputError(`Invalid component ${name}`);
    }
    const version = (raw as Record<string, unknown>).version;
    if (
      version !== undefined &&
      version !== null &&
      typeof version !== "string" &&
      typeof version !== "number"
    ) {
      throw new InputError(`Invalid component version for ${name}`);
    }
    return {
      name,
      ...(version === undefined || version === null ? {} : { version: String(version) }),
    };
  });
}

async function declaration(workspace: string, paths: string[]): Promise<string | undefined> {
  let found: string | undefined;
  for (const path of paths) if (await exists(resolve(workspace, path))) found = path;
  return found;
}
