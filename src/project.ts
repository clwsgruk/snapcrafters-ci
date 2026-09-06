import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { resolve, sep } from "node:path";
import { parse } from "yaml";

export function mapping(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Expected a mapping");
  return value as Record<string, unknown>;
}
export function yaml(source: string) {
  return mapping(parse(source, { intAsBigInt: true, uniqueKeys: true, maxAliasCount: 50 }));
}
export function project(input = "", cwd = process.cwd()) {
  const publicRoot = input || ".";
  const checkout = realpathSync(cwd),
    requested = resolve(checkout, publicRoot);
  if (requested !== checkout && !requested.startsWith(`${checkout}${sep}`))
    throw Error("Project root must stay inside the checkout");
  const root = realpathSync(requested);
  if (root !== requested || !lstatSync(root).isDirectory())
    throw Error("Project root must be a regular checkout directory");
  const candidates = [
    ".snapcraft.yaml",
    "build-aux/snap/snapcraft.yaml",
    "snap/snapcraft.yaml",
    "snapcraft.yaml",
  ];
  const file = candidates.filter((p) => existsSync(resolve(root, p))).at(-1);
  if (!file) throw Error(`No snapcraft.yaml found in ${root}`);
  const absoluteYaml = resolve(root, file);
  const data = yaml(readProjectFile(absoluteYaml));
  const declaration = (kind: string) =>
    [`${kind}-declaration.json`, `.github/${kind}-declaration.json`]
      .filter((p) => existsSync(resolve(cwd, p)))
      .at(-1) || "";
  const plugs = declaration("plug"),
    slots = declaration("slot");
  for (const declaration of [plugs, slots])
    if (declaration) readProjectFile(resolve(checkout, declaration), 65536);
  const components = data.components == null ? {} : mapping(data.components);
  return {
    root,
    yaml: absoluteYaml,
    data,
    plugs: plugs ? resolve(cwd, plugs) : "",
    slots: slots ? resolve(cwd, slots) : "",
    outputs: {
      "project-root": publicRoot,
      "yaml-path": `${publicRoot}/${file}`,
      "snap-name": scalar(data.name),
      version: scalar(data.version),
      classic: String(data.confinement === "classic"),
      "plugs-file": plugs,
      "slots-file": slots,
      components: Object.entries(components)
        .map(([name, value]) => `${name}|${scalar(mapping(value).version)}`)
        .join(","),
    },
  };
}

function readProjectFile(file: string, limit = 1024 * 1024): string {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit)
      throw Error("Project input must be a bounded regular file");
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}

export const supportedArchitectures = [
  "amd64",
  "arm64",
  "armhf",
  "i386",
  "ppc64el",
  "riscv64",
  "s390x",
];
export function architecture(value: unknown): string {
  if (typeof value !== "string" || !supportedArchitectures.includes(value))
    throw Error(`Unsupported architecture: ${scalar(value)}`);
  return value;
}
function archList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  if (!list.length) throw Error("Empty architecture declaration");
  return list.map(architecture);
}
export function architectures(data: Record<string, unknown>): string[] {
  if (
    data.base !== undefined &&
    !["core18", "core20", "core22", "core24"].includes(scalar(data.base))
  )
    throw Error("Unsupported base");
  if (!data.architectures && !data.platforms)
    throw Error("Explicitly declare architectures or platforms");
  if (data.architectures && data.platforms) throw Error("Ambiguous architectures and platforms");
  let result: string[];
  if (data.base === "core24") {
    result = Object.entries(mapping(data.platforms)).flatMap(([label, value]) => {
      if (value === null) return [architecture(label)];
      const fields = mapping(value);
      if (Object.keys(fields).some((k) => !["build-on", "build-for"].includes(k)))
        throw Error("Unknown platform field");
      archList(fields["build-on"] ?? label);
      const targets = archList(fields["build-for"] ?? label);
      if (targets.length !== 1) throw Error("Ambiguous platform targets");
      return targets;
    });
  } else {
    if (!Array.isArray(data.architectures)) throw Error("Expected architectures list");
    result = data.architectures.flatMap((value) => {
      if (typeof value === "string") return [architecture(value)];
      const fields = mapping(value);
      if (Object.keys(fields).some((k) => !["build-on", "run-on"].includes(k)))
        throw Error("Unknown architecture field");
      const builders = archList(fields["build-on"]);
      if (fields["run-on"] !== undefined) {
        const targets = archList(fields["run-on"]);
        if (!builders.every((builder) => targets.includes(builder)))
          throw Error("Ambiguous legacy cross-architecture run-on");
      }
      return builders;
    });
  }
  if (!result.length) throw Error("Empty architecture matrix");
  return [...new Set(result)];
}

export function scalar(value: unknown): string {
  if (value == null) return "null";
  if (!["string", "number", "bigint", "boolean"].includes(typeof value))
    throw Error("Expected a scalar");
  return String(value as string | number | bigint | boolean);
}
