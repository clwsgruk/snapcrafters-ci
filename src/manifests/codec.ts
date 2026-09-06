import { parse } from "yaml";
import { InputError } from "../runtime/errors.js";
import type { Architecture } from "../project/types.js";

export interface Manifest {
  name: string;
  architecture: Architecture;
  revision: string;
}

const manifestName = /^manifest-(amd64|arm64|armhf|i386|ppc64el|riscv64|s390x)\.ya?ml$/;

export function decodeManifest(source: string, filename: string): Manifest {
  if (Buffer.byteLength(source) > 64 * 1024) throw new InputError("Manifest exceeds size limit");
  const match = manifestName.exec(filename);
  if (!match) throw new InputError(`Invalid manifest filename: ${filename}`);
  const value = parse(source, { uniqueKeys: true }) as Record<string, unknown>;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InputError("Manifest must be a mapping");
  if (typeof value.name !== "string" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(value.name)) {
    throw new InputError("Invalid manifest snap name");
  }
  if (value.architecture !== match[1])
    throw new InputError("Manifest architecture does not match filename");
  const revision = String(value.revision);
  if (!/^[1-9][0-9]*$/.test(revision)) throw new InputError("Revision must be a positive decimal");
  return { name: value.name, architecture: value.architecture as Architecture, revision };
}

export function encodeManifest(manifest: Manifest): string {
  return `name: ${manifest.name}\narchitecture: ${manifest.architecture}\nrevision: ${manifest.revision}\n`;
}

export function validateArchiveEntry(name: string, size: number, limit: number): void {
  if (name.startsWith("/") || name.startsWith("\\") || /^[A-Za-z]:/.test(name)) {
    throw new InputError("Absolute archive path is forbidden");
  }
  if (name.includes("/") || name.includes("\\") || name === ".." || name.includes("../")) {
    throw new InputError("Archive traversal or nested destination is forbidden");
  }
  if (!manifestName.test(name)) throw new InputError(`Unexpected archive entry: ${name}`);
  if (size > limit) throw new InputError("Archive entry exceeds decompression limit");
}
