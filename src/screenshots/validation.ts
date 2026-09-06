import { isAbsolute } from "node:path";
import type { Manifest } from "../manifests/codec.js";
import { InputError } from "../runtime/errors.js";

export function validateCaptureRequest(input: {
  snap: string;
  app: string;
  actionPath: string;
  manifests: Manifest[];
}): Manifest | undefined {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(input.snap)) throw new InputError("Invalid snap name");
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(input.app))
    throw new InputError("Invalid snap application name");
  if (!isAbsolute(input.actionPath)) throw new InputError("Action path must be absolute");
  const amd64 = input.manifests.find(
    (manifest) => manifest.architecture === "amd64" && manifest.name === input.snap,
  );
  if (input.manifests.some((manifest) => manifest.architecture === "amd64") && !amd64)
    throw new InputError("Manifest snap does not match project");
  return amd64;
}

export function validateScreenshotUpload(input: {
  repository: string;
  sourceRepository: string;
  snap: string;
  issue: string;
  date: string;
  screen: Buffer;
  window: Buffer;
  author: { name: string; email: string };
  runId: string;
  sourceSha: string;
}): void {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(input.snap) || !/^[1-9][0-9]*$/.test(input.issue))
    throw new InputError("Invalid screenshot snap or issue");
  if (!validRepository(input.repository) || !validRepository(input.sourceRepository))
    throw new InputError("Invalid screenshot repository");
  if (!validDate(input.date)) throw new InputError("Invalid screenshot date");
  if (!/^[1-9][0-9]*$/.test(input.runId) || !/^[0-9a-f]{40}$/.test(input.sourceSha))
    throw new InputError("Invalid screenshot source identity");
  if (
    !input.author.name ||
    input.author.name.includes("\n") ||
    Buffer.byteLength(input.author.name) > 100 ||
    !/^[^\s@]+@[^\s@]+$/.test(input.author.email) ||
    Buffer.byteLength(input.author.email) > 254
  )
    throw new InputError("Invalid screenshot commit author");
  if (input.screen.length > 10 * 1024 * 1024 || input.window.length > 10 * 1024 * 1024)
    throw new InputError("Screenshot exceeds size limit");
  validatePng(input.screen);
  validatePng(input.window);
}

export function gitSha(value: string, label: string): string {
  if (!/^[0-9a-f]{40}$/.test(value)) throw new InputError(`Invalid Git ${label} SHA`);
  return value;
}

export function validatePng(value: Buffer): void {
  if (
    value.length < 8 ||
    !value.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new InputError("Screenshot must be a non-empty PNG image");
}

export function confirmedRefConflict(error: unknown): boolean {
  const status = (error as { status?: number }).status;
  const message = error instanceof Error ? error.message : "";
  return (
    (status === 409 && /conflict/i.test(message)) ||
    (status === 422 && /reference update failed|not a fast forward/i.test(message))
  );
}

function validRepository(value: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/.test(value);
}

function validDate(value: string): boolean {
  if (!/^[0-9]{8}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}
