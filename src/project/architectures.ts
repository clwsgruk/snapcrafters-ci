import { InputError } from "../runtime/errors.js";
import type { Architecture, BuildTarget } from "./types.js";

const supported = new Set<Architecture>([
  "amd64",
  "arm64",
  "armhf",
  "i386",
  "ppc64el",
  "riscv64",
  "s390x",
]);

function architecture(value: unknown, field: string): Architecture {
  if (typeof value !== "string" || !supported.has(value as Architecture)) {
    throw new InputError(`Unsupported ${field} architecture: ${String(value)}`);
  }
  return value as Architecture;
}

function list(value: unknown, field: string): Architecture[] {
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0) throw new InputError(`${field} cannot be empty`);
  return [...new Set(values.map((item) => architecture(item, field)))];
}

export function getBuildTargets(document: Record<string, unknown>): BuildTarget[] {
  const base = document.base;
  if (base === "core24") return fromPlatforms(document);
  if (base !== undefined && (typeof base !== "string" || !/^core(18|20|22)$/.test(base))) {
    throw new InputError(`Unsupported snap base: ${JSON.stringify(base)}`);
  }
  return fromArchitectures(document);
}

function fromArchitectures(document: Record<string, unknown>): BuildTarget[] {
  if (!("architectures" in document)) {
    throw new InputError("Recipe must declare architectures or platforms");
  }
  if (!Array.isArray(document.architectures) || document.architectures.length === 0) {
    throw new InputError("architectures must be a non-empty list");
  }
  const targets: BuildTarget[] = [];
  for (const entry of document.architectures) {
    if (typeof entry === "string") {
      const arch = architecture(entry, "architectures");
      targets.push({ buildOn: [arch], buildFor: arch });
      continue;
    }
    if (!entry || typeof entry !== "object") throw new InputError("Ambiguous architectures entry");
    const mapping = entry as Record<string, unknown>;
    const buildOn = list(mapping["build-on"], "build-on");
    if (mapping["build-for"] === undefined) {
      targets.push(...buildOn.map((arch) => ({ buildOn: [arch], buildFor: arch })));
    } else {
      const buildFor = list(mapping["build-for"], "build-for");
      if (buildFor.length !== 1)
        throw new InputError("Each architecture entry must have one build-for");
      targets.push({ buildOn, buildFor: buildFor[0]! });
    }
  }
  return deduplicate(targets);
}

function fromPlatforms(document: Record<string, unknown>): BuildTarget[] {
  if (!("platforms" in document)) {
    throw new InputError("core24 recipe must declare platforms");
  }
  if (
    !document.platforms ||
    typeof document.platforms !== "object" ||
    Array.isArray(document.platforms)
  ) {
    throw new InputError("platforms must be a non-empty mapping");
  }
  const entries = Object.entries(document.platforms as Record<string, unknown>);
  if (entries.length === 0) throw new InputError("platforms must be a non-empty mapping");
  return deduplicate(
    entries.map(([platform, value]) => {
      if (value === null) {
        const arch = architecture(platform, "platform label");
        return { platform, buildOn: [arch], buildFor: arch };
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new InputError(`Ambiguous platform ${platform}`);
      }
      const mapping = value as Record<string, unknown>;
      const buildOn = list(mapping["build-on"], `${platform}.build-on`);
      const buildFor = list(mapping["build-for"], `${platform}.build-for`);
      if (buildFor.length !== 1)
        throw new InputError(`Platform ${platform} must have one build-for`);
      return { platform, buildOn, buildFor: buildFor[0]! };
    }),
  );
}

function deduplicate(targets: BuildTarget[]): BuildTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    if (seen.has(target.buildFor)) return false;
    seen.add(target.buildFor);
    return true;
  });
}
