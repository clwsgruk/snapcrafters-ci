import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, lstat, mkdir, opendir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { stringify } from "yaml";
import { encodeManifest } from "../manifests/codec.js";
import { getBuildTargets } from "../project/architectures.js";
import { parseProject } from "../project/parse.js";
import type { Architecture } from "../project/types.js";
import { InputError, PartialPublicationError } from "../runtime/errors.js";
import { ownedTemp, removeOwned } from "../runtime/files.js";
import { retryDelay, systemClock, type Clock } from "../runtime/clock.js";
import type { ProcessResult, ProcessSpec } from "../runtime/process.js";
import { parseUploadRevision } from "./store-output.js";
import type { Published, ReleaseResult, SnapIdentity, StoreRevision } from "./types.js";

export { parseUploadRevision } from "./store-output.js";

const MAX_SNAP_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_COMPONENT_BYTES = 2 * 1024 * 1024 * 1024;

export interface ReleaseInput {
  workspace: string;
  projectRoot: string;
  architecture: Architecture;
  channel: string;
  snapcraftChannel: string;
  launchpadToken: string;
  storeToken: string;
  sourceSha: string;
  signal?: AbortSignal;
  tempRoot?: string;
}

export interface ReleaseDependencies {
  clock?: Clock;
  random?: () => number;
  run(spec: ProcessSpec): Promise<ProcessResult>;
  inspectSnap(path: string, cwd: string, signal: AbortSignal): Promise<SnapIdentity>;
  review(
    snap: string,
    cwd: string,
    signal: AbortSignal,
    options: { classic: boolean; plugs?: string; slots?: string },
  ): Promise<void>;
  readback(
    snap: string,
    channel: string,
    architecture: Architecture,
    signal: AbortSignal,
  ): Promise<StoreRevision[]>;
  recordPublication(published: Published): Promise<void>;
  writeManifest(path: string, contents: string): Promise<void>;
}

export async function runRelease(
  input: ReleaseInput,
  deps: ReleaseDependencies,
): Promise<ReleaseResult> {
  const owner = `release-${input.sourceSha}-${randomUUID()}`;
  const scratch = await ownedTemp(input.tempRoot ?? tmpdir(), "snapcrafters-release-", owner);
  const stage = join(scratch, "project");
  const home = join(scratch, "home");
  const signal = input.signal ?? new AbortController().signal;
  const completed: string[] = [];
  let published: Published | undefined;
  let primaryError: unknown;
  let outcome: ReleaseResult | undefined;
  try {
    const source = await parseProject(input.workspace, input.projectRoot);
    const target = getBuildTargets(source.document).find(
      ({ buildFor }) => buildFor === input.architecture,
    );
    if (!target) throw new InputError(`Recipe has no target for ${input.architecture}`);
    await rejectSymlinks(source.root);
    await cp(source.root, stage, {
      recursive: true,
      errorOnExist: true,
      filter: (path) => {
        const name = basename(path);
        return (
          name !== ".git" && !/\.(snap|comp)$/.test(name) && !/^snapcraft-.*\.txt$/.test(name)
        );
      },
    });
    const stagedYaml = join(stage, relative(source.root, source.yamlPath));
    if (source.base !== "core24") {
      const restricted = {
        ...source.document,
        architectures: [{ "build-on": target.buildOn, "run-on": [target.buildFor] }],
      };
      await writeFile(stagedYaml, stringify(restricted), { mode: 0o600 });
    }
    await createCredentials(home, input.launchpadToken);
    const env = { PATH: process.env.PATH ?? "", HOME: home };
    await prepareStagedGit(stage, env, signal, deps);
    await mustSucceed(
      deps,
      {
        file: "sudo",
        args: ["snap", "install", "snapcraft", "--channel", input.snapcraftChannel, "--classic"],
        cwd: stage,
        env,
        timeoutMs: 5 * 60_000,
        signal,
        redact: [input.launchpadToken, input.storeToken],
      },
      "Snapcraft installation",
    );
    const buildArgs = ["remote-build", "--launchpad-accept-public-upload"];
    if (source.base === "core24") buildArgs.push(`--build-for=${input.architecture}`);
    const build = await deps.run({
      file: "snapcraft",
      args: buildArgs,
      cwd: stage,
      env,
      timeoutMs: 2 * 60 * 60_000,
      signal,
      redact: [input.launchpadToken, input.storeToken],
    });
    if (build.exitCode !== 0) throw new Error(`Remote build failed (${build.exitCode})`);
    const snap = await findFreshSnap(stage);
    const identity = await deps.inspectSnap(snap, stage, signal);
    validateIdentity(identity, source.name, source.version, input.architecture, snap);
    const digest = await hashArtifact(snap);
    const componentArgs = await componentArguments(stage, source.name, source.components);
    completed.push("build");
    await deps.review(snap, stage, signal, {
      classic: source.classic,
      ...(source.plugsFile ? { plugs: join(input.workspace, source.plugsFile) } : {}),
      ...(source.slotsFile ? { slots: join(input.workspace, source.slotsFile) } : {}),
    });
    completed.push("review");
    const before = await deps.readback(source.name, input.channel, input.architecture, signal);
    const upload = await deps.run({
      file: "snapcraft",
      args: ["upload", snap, ...componentArgs, `--release=${input.channel}`],
      cwd: stage,
      env: { PATH: env.PATH, SNAPCRAFT_STORE_CREDENTIALS: input.storeToken },
      timeoutMs: 20 * 60_000,
      signal,
      redact: [input.launchpadToken, input.storeToken],
    });
    const clock = deps.clock ?? systemClock;
    const random = deps.random ?? Math.random;
    let revision: string | undefined;
    let lastReadbackError: unknown;
    let lastReconcileError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const after = await deps.readback(source.name, input.channel, input.architecture, signal);
        revision = reconcilePublication(upload, source.name, identity, digest, before, after);
        break;
      } catch (error) {
        if (error instanceof PartialPublicationError) lastReconcileError = error;
        else lastReadbackError = error;
        if (attempt < 2) await clock.sleep(retryDelay(attempt, undefined, random), signal);
      }
    }
    if (!revision) {
      if (lastReadbackError)
        throw new PartialPublicationError(
          "Upload attempted; exact Store readback failed and publication is ambiguous",
          completed,
          { cause: lastReadbackError },
        );
      throw lastReconcileError ?? new Error("Publication reconciliation failed");
    }
    published = {
      snap: source.name,
      revision,
      channel: input.channel,
      architecture: input.architecture,
      version: identity.version,
      digest,
      sourceSha: input.sourceSha,
    };
    completed.push("publish");
    try {
      await deps.recordPublication(published);
    } catch (error) {
      throw new PartialPublicationError(
        `Published revision ${revision}; publication record failed`,
        completed,
        { cause: error },
      );
    }
    const manifestPath = join(input.workspace, `manifest-${input.architecture}.yaml`);
    try {
      await deps.writeManifest(
        manifestPath,
        encodeManifest({
          name: source.name,
          architecture: input.architecture,
          revision,
          version: identity.version,
        }),
      );
    } catch (error) {
      throw new PartialPublicationError(
        `Published revision ${revision}; manifest recording failed`,
        completed,
        { cause: error },
      );
    }
    completed.push("manifest");
    outcome = { published, completedStages: completed, manifestPath };
  } catch (error) {
    primaryError = error;
  }
  let cleanupError: unknown;
  try {
    await removeOwned(scratch, owner);
  } catch (error) {
    cleanupError = error;
  }
  if (primaryError) throw primaryError;
  if (cleanupError) {
    if (published)
      throw new PartialPublicationError(
        `Published revision ${published.revision}; staging cleanup failed`,
        completed,
        { cause: cleanupError },
      );
    throw cleanupError;
  }
  return outcome!;
}

function reconcilePublication(
  upload: ProcessResult,
  snap: string,
  identity: SnapIdentity,
  digest: string,
  before: readonly StoreRevision[],
  after: readonly StoreRevision[],
): string {
  let reported: string | undefined;
  try {
    if (upload.exitCode === 0)
      reported = parseUploadRevision(`${upload.stdout}\n${upload.stderr}`, snap);
  } catch {}
  const prior = new Set(before.map(({ revision }) => revision));
  const candidates = after.filter(
    (item) =>
      !prior.has(item.revision) &&
      item.architecture === identity.architecture &&
      item.version === identity.version &&
      item.digest?.toLowerCase() === digest,
  );
  if (reported) {
    if (candidates.some(({ revision }) => revision === reported)) return reported;
    throw new PartialPublicationError(
      `Upload reported revision ${reported}, but exact Store readback could not bind it`,
      ["build", "review"],
    );
  }
  if (candidates.length === 1) return candidates[0]!.revision;
  throw new PartialPublicationError(
    `Ambiguous publication after upload exit ${upload.exitCode}; exact Store readback found ${candidates.length} new revisions`,
    ["build", "review"],
  );
}

function validateIdentity(
  identity: SnapIdentity,
  name: string,
  literalVersion: string | undefined,
  architecture: Architecture,
  path: string,
): void {
  if (identity.name !== name)
    throw new InputError("Built artifact snap name does not match recipe");
  if (identity.architecture !== architecture)
    throw new InputError("Built artifact architecture does not match requested target");
  if (
    !identity.version ||
    identity.version.includes("\n") ||
    Buffer.byteLength(identity.version) > 128
  ) {
    throw new InputError("Built artifact has an invalid adopted version");
  }
  if (literalVersion !== undefined && identity.version !== literalVersion)
    throw new InputError("Built artifact version does not match recipe");
  const expected = `${name}_${identity.version}_${architecture}.snap`;
  if (basename(path) !== expected)
    throw new InputError(`Built artifact filename must be ${expected}`);
}

async function findFreshSnap(stage: string): Promise<string> {
  const candidates = (await readdir(stage, { withFileTypes: true })).filter((entry) =>
    entry.name.endsWith(".snap"),
  );
  if (candidates.length !== 1) {
    throw new Error(
      `Fresh build produced ${candidates.length} snap artifacts; expected exactly one`,
    );
  }
  if (!candidates[0]!.isFile()) throw new InputError("Built snap artifact must be a regular file");
  const path = join(stage, candidates[0]!.name);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw new InputError("Built snap artifact must be a regular file");
  if (info.size <= 0 || info.size > MAX_SNAP_BYTES)
    throw new InputError("Built snap artifact has invalid size");
  return path;
}

async function hashArtifact(path: string): Promise<string> {
  const hash = createHash("sha3-384");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function componentArguments(
  stage: string,
  snap: string,
  components: readonly { name: string; version?: string }[],
): Promise<string[]> {
  const result: string[] = [];
  for (const component of components) {
    const filename = component.version
      ? `${snap}+${component.name}_${component.version}.comp`
      : `${snap}+${component.name}.comp`;
    const path = join(stage, filename);
    let info;
    try {
      info = await lstat(path);
    } catch {
      throw new Error(`Component artifact is missing: ${filename}`);
    }
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size <= 0 ||
      info.size > MAX_COMPONENT_BYTES
    )
      throw new InputError(`Component artifact is not a bounded regular file: ${filename}`);
    result.push("--component", `${component.name}=${path}`);
  }
  return result;
}

async function rejectSymlinks(root: string): Promise<void> {
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop()!;
    const entries = await opendir(directory);
    for await (const entry of entries) {
      if (entry.name === ".git") continue;
      const path = join(directory, entry.name);
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new InputError(`Project symlink is forbidden: ${path}`);
      if (info.isDirectory()) pending.push(path);
      else if (!info.isFile()) throw new InputError(`Unsupported project file type: ${path}`);
    }
  }
}

async function createCredentials(home: string, token: string): Promise<void> {
  const provider = join(home, ".local/share/snapcraft/provider/launchpad");
  const legacy = join(home, ".local/share/snapcraft");
  await mkdir(provider, { recursive: true, mode: 0o700 });
  await writeFile(join(provider, "credentials"), token, { mode: 0o600 });
  await writeFile(join(legacy, "launchpad-credentials"), token, { mode: 0o600 });
}

async function prepareStagedGit(
  stage: string,
  env: Record<string, string>,
  signal: AbortSignal,
  deps: ReleaseDependencies,
): Promise<void> {
  const commands = [
    ["-c", "init.defaultBranch=snapcrafters-ci", "init"],
    ["add", "--all"],
    [
      "-c",
      "user.name=Snapcrafters CI staging",
      "-c",
      "user.email=snapcrafters-ci@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "Snapcrafters CI staged source",
    ],
  ];
  for (const args of commands)
    await mustSucceed(
      deps,
      { file: "git", args, cwd: stage, env, timeoutMs: 60_000, signal },
      "Staged Git preparation",
    );
}

async function mustSucceed(
  deps: ReleaseDependencies,
  spec: ProcessSpec,
  stage: string,
): Promise<void> {
  const result = await deps.run(spec);
  if (result.exitCode !== 0) throw new Error(`${stage} failed (${result.exitCode})`);
}

export async function recordReleaseTag(
  input: {
    cwd: string;
    name: string;
    version: string;
    revision: string;
    architecture: Architecture;
    multiSnap: boolean;
    botName: string;
    botEmail: string;
    sourceSha: string;
    signal?: AbortSignal;
  },
  run: ReleaseDependencies["run"],
): Promise<void> {
  if (
    !/^[a-z0-9][a-z0-9-]{0,39}$/.test(input.name) ||
    !input.version ||
    input.version.includes("\n") ||
    Buffer.byteLength(input.version) > 128 ||
    !/^[1-9][0-9]*$/.test(input.revision) ||
    !input.botName ||
    input.botName.includes("\n") ||
    Buffer.byteLength(input.botName) > 100 ||
    !/^[^\s@]+@[^\s@]+$/.test(input.botEmail) ||
    Buffer.byteLength(input.botEmail) > 254 ||
    !/^[0-9a-f]{40}$/.test(input.sourceSha)
  )
    throw new InputError("Invalid release tag identity");
  const tag = `${input.multiSnap ? `${input.name}-` : ""}${input.version}/rev${input.revision}/${input.architecture}`;
  const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? input.cwd };
  const signal = input.signal ?? new AbortController().signal;
  const execute = (args: readonly string[]) =>
    run({ file: "git", args, cwd: input.cwd, env, timeoutMs: 5 * 60_000, signal });
  const head = await execute(["rev-parse", "HEAD"]);
  if (head.exitCode !== 0 || head.stdout.trim() !== input.sourceSha)
    throw new InputError("Release state does not match the checked-out source commit");
  const local = await execute(["rev-parse", "-q", "--verify", `refs/tags/${tag}^{commit}`]);
  if (local.exitCode === 0 && local.stdout.trim() !== input.sourceSha)
    throw new InputError("Existing release tag points at a different commit");
  const remoteBefore = await execute([
    "ls-remote",
    "origin",
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`,
  ]);
  if (remoteBefore.exitCode !== 0)
    throw new PartialPublicationError(
      `Published revision ${input.revision}; tag readback failed`,
      ["publish", "manifest"],
    );
  const existingRemote = parseRemoteTag(remoteBefore.stdout, tag);
  if (existingRemote && existingRemote !== input.sourceSha)
    throw new InputError("Existing remote release tag points at a different commit");
  if (existingRemote === input.sourceSha) return;
  if (local.exitCode !== 0) {
    const created = await execute([
      "-c",
      `user.name=${input.botName}`,
      "-c",
      `user.email=${input.botEmail}`,
      "tag",
      "-a",
      tag,
      "-m",
      `Revision ${input.revision}, released for ${input.architecture}`,
    ]);
    if (created.exitCode !== 0)
      throw new PartialPublicationError(`Published revision ${input.revision}; tagging failed`, [
        "publish",
        "manifest",
      ]);
  }
  const pushed = await execute(["push", "origin", tag]);
  const remoteAfter = await execute([
    "ls-remote",
    "origin",
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`,
  ]);
  if (remoteAfter.exitCode !== 0 || parseRemoteTag(remoteAfter.stdout, tag) !== input.sourceSha)
    throw new PartialPublicationError(
      `Published revision ${input.revision}; tagging failed after push exit ${pushed.exitCode}`,
      ["publish", "manifest"],
    );
}

function parseRemoteTag(output: string, tag: string): string | undefined {
  let direct: string | undefined;
  let peeled: string | undefined;
  for (const line of output.trim().split("\n")) {
    if (!line) continue;
    const [sha, ref] = line.split("\t");
    if (!sha || !/^[0-9a-f]{40}$/.test(sha)) throw new InputError("Invalid remote tag readback");
    if (ref === `refs/tags/${tag}`) direct = sha;
    else if (ref === `refs/tags/${tag}^{}`) peeled = sha;
    else throw new InputError("Unexpected remote tag readback ref");
  }
  return peeled ?? direct;
}
