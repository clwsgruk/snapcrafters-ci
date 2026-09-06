import { parseDocument } from "yaml";
import { InputError } from "../runtime/errors.js";
import type { Component } from "./types.js";

export interface ProjectDocument {
  document: Record<string, unknown>;
  name: string;
  version?: string;
  adoptInfo?: string;
  classic: boolean;
  base?: string;
  components: Component[];
}

export function parseProjectDocument(source: Buffer): ProjectDocument {
  const parsed = parseDocument(source.toString("utf8"), { uniqueKeys: true });
  if (parsed.errors.length)
    throw new InputError(`Invalid snapcraft YAML: ${parsed.errors[0]!.message}`);
  const document = parsed.toJS() as unknown;
  if (!document || typeof document !== "object" || Array.isArray(document))
    throw new InputError("snapcraft.yaml must be a mapping");
  const mapping = document as Record<string, unknown>;
  if (typeof mapping.name !== "string" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(mapping.name))
    throw new InputError("Invalid snap name");
  return {
    document: mapping,
    name: mapping.name,
    ...(typeof mapping.version === "string" || typeof mapping.version === "number"
      ? { version: String(mapping.version) }
      : {}),
    ...(typeof mapping["adopt-info"] === "string" ? { adoptInfo: mapping["adopt-info"] } : {}),
    classic: mapping.confinement === "classic",
    ...(typeof mapping.base === "string" ? { base: mapping.base } : {}),
    components: parseComponents(mapping.components),
  };
}

function parseComponents(value: unknown): Component[] {
  if (value === undefined || value === null) return [];
  if (typeof value !== "object" || Array.isArray(value))
    throw new InputError("components must be a mapping");
  return Object.entries(value as Record<string, unknown>).map(([name, raw]) => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || !raw || typeof raw !== "object")
      throw new InputError(`Invalid component ${name}`);
    const version = (raw as Record<string, unknown>).version;
    if (
      version !== undefined &&
      version !== null &&
      typeof version !== "string" &&
      typeof version !== "number"
    )
      throw new InputError(`Invalid component version for ${name}`);
    return {
      name,
      ...(version === undefined || version === null ? {} : { version: String(version) }),
    };
  });
}
