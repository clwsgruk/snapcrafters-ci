import * as core from "@actions/core";
import { constants } from "node:fs";
import { open, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { actionContext, type ActionContext } from "../actions/context.js";
import {
  architecture,
  boolean,
  channel,
  optional,
  positiveDecimal,
  required,
} from "../actions/inputs.js";
import { actionSignal } from "../actions/signal.js";
import { encodeManifest } from "../manifests/codec.js";
import { InputError } from "../runtime/errors.js";
import { runProcess } from "../runtime/process.js";
import { runReview } from "../review/run.js";
import { recordReleaseTag, runRelease } from "./run.js";
import { inspectSnapArtifact, snapcraftRevisionReader } from "./snapcraft.js";
import { readReleaseState } from "./read-state.js";

export interface ReleaseActionDependencies {
  context?: (env: NodeJS.ProcessEnv) => Promise<ActionContext>;
  release?: typeof runRelease;
  recordTag?: typeof recordReleaseTag;
  readState?: typeof readReleaseState;
}

export async function runReleaseAction(
  env: NodeJS.ProcessEnv,
  dependencies: ReleaseActionDependencies = {},
): Promise<void> {
  const context = await (dependencies.context ?? actionContext)(env);
  const target = architecture(required(env, "architecture"));
  const statePath = join(context.workspace, `.snapcrafters-release-${target}.json`);
  const cancellation = actionSignal();
  try {
    if (env.SNAPCRAFTERS_PHASE === "tag") {
      const requested = positiveDecimal(required(env, "published-revision"), "revision");
      const state = await (dependencies.readState ?? readReleaseState)(statePath);
      if (state.revision !== requested) throw new InputError("Release state revision mismatch");
      if (state.architecture !== target)
        throw new InputError("Release state architecture mismatch");
      if (state.sourceSha !== context.sha)
        throw new InputError("Release state source SHA mismatch");
      await (dependencies.recordTag ?? recordReleaseTag)(
        {
          cwd: context.workspace,
          name: state.snap,
          version: state.version,
          revision: state.revision,
          architecture: state.architecture,
          sourceSha: state.sourceSha,
          multiSnap: boolean(optional(env, "multi-snap", "false"), "multi-snap"),
          botName: optional(env, "bot-name", "Snapcrafters Bot"),
          botEmail: optional(env, "bot-email", "snapforge.team@gmail.com"),
          signal: cancellation.signal,
        },
        runProcess,
      );
      await unlink(statePath);
      return;
    }
    const resumed = await optionalReleaseState(
      statePath,
      dependencies.readState ?? readReleaseState,
    );
    if (resumed) {
      if (resumed.architecture !== target)
        throw new InputError("Release state architecture mismatch");
      if (resumed.channel !== channel(optional(env, "channel", "latest/candidate")))
        throw new InputError("Release state channel mismatch");
      if (resumed.sourceSha !== context.sha)
        throw new InputError("Release state source SHA mismatch");
      await ensureManifest(context.workspace, resumed);
      core.setOutput("revision", resumed.revision);
      return;
    }
    const launchpadToken = required(env, "launchpad-token", 4_096);
    const storeToken = required(env, "store-token", 16_384);
    core.setSecret(launchpadToken);
    core.setSecret(storeToken);
    await (dependencies.release ?? runRelease)(
      {
        workspace: context.workspace,
        projectRoot: optional(env, "snapcraft-project-root"),
        architecture: target,
        channel: channel(optional(env, "channel", "latest/candidate")),
        snapcraftChannel: channel(optional(env, "snapcraft-channel", "latest/stable")),
        launchpadToken,
        storeToken,
        sourceSha: context.sha,
        signal: cancellation.signal,
      },
      {
        run: runProcess,
        inspectSnap: inspectSnapArtifact,
        review: async (snap, cwd, signal, options) =>
          void (await runReview({ snap, ...options }, cwd, signal)),
        readback: snapcraftRevisionReader(storeToken, context.workspace),
        recordPublication: async (published) => {
          core.setOutput("revision", published.revision);
          await writeFile(statePath, JSON.stringify(published), { flag: "wx", mode: 0o600 });
        },
        writeManifest: async (path, contents) =>
          writeFile(path, contents, { flag: "wx", mode: 0o600 }),
      },
    );
  } finally {
    cancellation.dispose();
  }
}

async function optionalReleaseState(path: string, readState: typeof readReleaseState) {
  try {
    return await readState(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function ensureManifest(
  workspace: string,
  published: Awaited<ReturnType<typeof readReleaseState>>,
) {
  const path = join(workspace, `manifest-${published.architecture}.yaml`);
  const expected = encodeManifest({
    name: published.snap,
    architecture: published.architecture,
    revision: published.revision,
    version: published.version,
  });
  try {
    await writeFile(path, expected, { flag: "wx", mode: 0o600 });
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > 64 * 1024)
      throw new InputError("Existing release manifest is not a bounded regular file");
    if ((await handle.readFile("utf8")) !== expected)
      throw new InputError("Existing release manifest does not match publication state");
  } finally {
    await handle.close();
  }
}
