import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Architecture } from "../project/types.js";
import { InputError } from "../runtime/errors.js";
import { ownedTemp, removeOwned } from "../runtime/files.js";
import { runProcess, type ProcessResult, type ProcessSpec } from "../runtime/process.js";
import type { SnapIdentity, StoreRevision } from "./types.js";
import { parseRevisionRows, parseSnapMetadata } from "./store-output.js";

export { isRevisionReleased, parseRevisions, parseSnapMetadata } from "./store-output.js";

export async function inspectSnapArtifact(
  path: string,
  cwd: string,
  signal: AbortSignal,
  run: (spec: ProcessSpec) => Promise<ProcessResult> = runProcess,
): Promise<SnapIdentity> {
  const result = await run({
    file: "unsquashfs",
    args: ["-cat", path, "meta/snap.yaml"],
    cwd,
    env: { PATH: process.env.PATH ?? "" },
    timeoutMs: 60_000,
    signal,
    maxOutputBytes: 1024 * 1024,
  });
  if (result.exitCode !== 0)
    throw new InputError(`Cannot inspect built snap (${result.exitCode})`);
  return parseSnapMetadata(result.stdout);
}

export function snapcraftRevisionReader(
  storeToken: string,
  cwd: string,
  run: (spec: ProcessSpec) => Promise<ProcessResult> = runProcess,
): (
  snap: string,
  channel: string,
  architecture: Architecture,
  signal: AbortSignal,
) => Promise<StoreRevision[]> {
  let baseline: Set<string> | undefined;
  return async (snap, channel, architecture, signal) => {
    const env = {
      PATH: process.env.PATH ?? "",
      SNAPCRAFT_STORE_CREDENTIALS: storeToken,
    };
    const listed = await run({
      file: "snapcraft",
      args: ["revisions", snap, "--arch", architecture],
      cwd,
      env,
      timeoutMs: 2 * 60_000,
      signal,
      maxOutputBytes: 4 * 1024 * 1024,
      redact: [storeToken],
    });
    if (listed.exitCode !== 0)
      throw new Error(`Snapcraft revisions failed (${listed.exitCode}): ${listed.stderr}`);
    const rows = parseRevisionRows(listed.stdout);
    const revisions: StoreRevision[] = rows
      .filter((row) => row.architectures.includes(architecture) && row.channels.includes(channel))
      .map((row) => ({ revision: row.revision, architecture, version: row.version }));
    if (!baseline) {
      baseline = new Set(rows.map(({ revision }) => revision));
      return revisions;
    }
    for (const revision of revisions) {
      if (!baseline.has(revision.revision))
        revision.digest = await downloadRevisionDigest(
          snap,
          revision.revision,
          env,
          signal,
          storeToken,
          run,
        );
    }
    return revisions;
  };
}

async function downloadRevisionDigest(
  snap: string,
  revision: string,
  env: Record<string, string>,
  signal: AbortSignal,
  token: string,
  run: (spec: ProcessSpec) => Promise<ProcessResult>,
): Promise<string> {
  const owner = `readback-${randomUUID()}`;
  const scratch = await ownedTemp(tmpdir(), "snapcrafters-readback-", owner);
  try {
    const result = await run({
      file: "snapcraft",
      args: ["download", snap, `--revision=${revision}`],
      cwd: scratch,
      env,
      timeoutMs: 10 * 60_000,
      signal,
      redact: [token],
    });
    if (result.exitCode !== 0)
      throw new Error(`Snapcraft revision download failed (${result.exitCode})`);
    const candidates = (await readdir(scratch, { withFileTypes: true })).filter(
      (entry) => entry.isFile() && entry.name.endsWith(".snap"),
    );
    if (candidates.length !== 1) throw new InputError("Revision readback produced no unique snap");
    const path = join(scratch, candidates[0]!.name);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size <= 0)
      throw new InputError("Revision readback snap is not a regular file");
    const hash = createHash("sha3-384");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest("hex");
  } finally {
    await removeOwned(scratch, owner);
  }
}
