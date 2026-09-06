import { parse } from "yaml";
import type { Architecture } from "../project/types.js";
import { InputError } from "../runtime/errors.js";
import type { SnapIdentity, StoreRevision } from "./types.js";

const architectures = new Set<Architecture>([
  "amd64",
  "arm64",
  "armhf",
  "i386",
  "ppc64el",
  "riscv64",
  "s390x",
]);

export interface RevisionRow {
  revision: string;
  architectures: Architecture[];
  version: string;
  channels: string[];
}

export function parseSnapMetadata(source: string): SnapIdentity {
  if (Buffer.byteLength(source) > 1024 * 1024) throw new InputError("Snap metadata exceeds limit");
  const value = parse(source, { uniqueKeys: true }) as Record<string, unknown>;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InputError("Snap metadata must be a mapping");
  if (typeof value.name !== "string" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(value.name))
    throw new InputError("Snap metadata has an invalid name");
  if (typeof value.version !== "string" || !value.version || value.version.includes("\n"))
    throw new InputError("Snap metadata has an invalid version");
  if (!Array.isArray(value.architectures) || value.architectures.length !== 1)
    throw new InputError("Built snap must declare exactly one architecture");
  const architecture = value.architectures[0];
  if (typeof architecture !== "string" || !architectures.has(architecture as Architecture))
    throw new InputError("Snap metadata has an unsupported architecture");
  return { name: value.name, version: value.version, architecture: architecture as Architecture };
}

export function parseRevisions(
  output: string,
  channel: string,
  architecture: Architecture,
): StoreRevision[] {
  return parseRevisionRows(output)
    .filter((row) => row.architectures.includes(architecture) && row.channels.includes(channel))
    .map((row) => ({ revision: row.revision, architecture, version: row.version }));
}

export function isRevisionReleased(output: string, revision: string, channel: string): boolean {
  if (!/^[1-9][0-9]*$/.test(revision)) throw new InputError("Invalid Store revision");
  if (
    !/^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}\/(stable|candidate|beta|edge)(\/[A-Za-z0-9][A-Za-z0-9.+-]{0,63})?$/.test(
      channel,
    )
  )
    throw new InputError("Invalid Store channel");
  const matches = parseRevisionRows(output).filter((row) => row.revision === revision);
  if (matches.length > 1) throw new InputError("Ambiguous Snapcraft revision rows");
  return matches[0]?.channels.includes(channel) ?? false;
}

export function parseRevisionRows(output: string): RevisionRow[] {
  const lines = output.trim().split("\n");
  const header = lines
    .shift()
    ?.trim()
    .split(/\s{2,}/);
  if (!header || header.join("|") !== "Rev.|Uploaded|Arches|Version|Channels")
    throw new InputError("Unexpected Snapcraft revisions header");
  const result: RevisionRow[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const fields = line.trim().split(/\s{2,}/);
    if (fields.length !== 5) throw new InputError("Unexpected Snapcraft revisions row");
    const [revision, uploaded, arches, version, channels] = fields as [
      string,
      string,
      string,
      string,
      string,
    ];
    if (!/^[1-9][0-9]*$/.test(revision) || Number.isNaN(Date.parse(uploaded)))
      throw new InputError("Invalid Snapcraft revision row");
    const rowArchitectures = arches.split(",");
    if (!rowArchitectures.every((item) => architectures.has(item as Architecture)))
      throw new InputError("Invalid Snapcraft revision architecture");
    if (!version || version.includes("\n")) throw new InputError("Invalid Snapcraft version");
    result.push({
      revision,
      architectures: rowArchitectures as Architecture[],
      version,
      channels: channels.split(",").map((item) => item.replace(/\*$/, "")),
    });
  }
  return result;
}

export function parseUploadRevision(output: string, expectedSnap: string): string {
  const matches = [
    ...output.matchAll(
      /^Revision ([1-9][0-9]*) created for '([a-z0-9][a-z0-9-]{0,39})'(?: and released to .+)?$/gm,
    ),
  ];
  if (matches.length === 0)
    throw new InputError("Snapcraft output did not contain its upload result");
  if (matches.length !== 1) throw new InputError("Ambiguous Snapcraft revision output");
  if (matches[0]![2] !== expectedSnap)
    throw new InputError(`Snapcraft output named unexpected snap ${matches[0]![2]}`);
  return matches[0]![1]!;
}
