import { InputError } from "../runtime/errors.js";
import type { Architecture } from "../project/types.js";

const supportedArchitectures = new Set<Architecture>([
  "amd64",
  "arm64",
  "armhf",
  "i386",
  "ppc64el",
  "riscv64",
  "s390x",
]);

export function required(env: NodeJS.ProcessEnv, name: string, maxBytes = 64 * 1024): string {
  const value = env[`INPUT_${name.toUpperCase().replaceAll("-", "_")}`];
  if (!value) throw new InputError(`Input ${name} is required`);
  if (Buffer.byteLength(value) > maxBytes)
    throw new InputError(`Input ${name} exceeds size limit`);
  if (value.includes("\0")) throw new InputError(`Input ${name} contains NUL`);
  return value;
}

export function optional(env: NodeJS.ProcessEnv, name: string, fallback = ""): string {
  return env[`INPUT_${name.toUpperCase().replaceAll("-", "_")}`] ?? fallback;
}

export function boolean(value: string, name: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new InputError(`${name} must be exactly true or false`);
}

export function positiveDecimal(value: string, name: string): string {
  if (!/^[1-9][0-9]*$/.test(value)) throw new InputError(`${name} must be a positive decimal`);
  return value;
}

export function channel(value: string): string {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}\/(stable|candidate|beta|edge)(\/[A-Za-z0-9][A-Za-z0-9.+-]{0,63})?$/.test(
      value,
    )
  ) {
    throw new InputError("Invalid channel");
  }
  return value;
}

export function architecture(value: string): Architecture {
  if (!supportedArchitectures.has(value as Architecture))
    throw new InputError("Invalid architecture");
  return value as Architecture;
}

export function architectureList(value: string): Architecture[] {
  if (!value || value.includes("\n") || value.includes("\r"))
    throw new InputError("Architectures must be a space-separated list");
  const values = value.split(" ");
  if (values.some((item) => !item) || new Set(values).size !== values.length)
    throw new InputError("Architectures contain an empty or duplicate entry");
  return values.map(architecture);
}

export function repository(value: string): { owner: string; name: string } {
  const match = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]{1,100})$/.exec(value);
  if (!match) throw new InputError("Invalid owner/repository");
  return { owner: match[1]!, name: match[2]! };
}
