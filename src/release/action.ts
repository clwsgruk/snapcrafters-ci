import * as core from "@actions/core";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { actionContext } from "../actions/context.js";
import {
  architecture,
  boolean,
  channel,
  optional,
  positiveDecimal,
  required,
} from "../actions/inputs.js";
import { actionSignal } from "../actions/signal.js";
import { InputError } from "../runtime/errors.js";
import { runProcess } from "../runtime/process.js";
import { runReview } from "../review/run.js";
import { recordReleaseTag, runRelease } from "./run.js";
import { inspectSnapArtifact, snapcraftRevisionReader } from "./snapcraft.js";
import { readReleaseState } from "./read-state.js";

export async function runReleaseAction(env: NodeJS.ProcessEnv): Promise<void> {
  const context = await actionContext(env);
  const target = architecture(required(env, "architecture"));
  const statePath = join(context.workspace, `.snapcrafters-release-${target}.json`);
  const cancellation = actionSignal();
  try {
    if (env.SNAPCRAFTERS_PHASE === "tag") {
      const requested = positiveDecimal(required(env, "published-revision"), "revision");
      const state = await readReleaseState(statePath);
      if (state.revision !== requested) throw new InputError("Release state revision mismatch");
      if (state.architecture !== target)
        throw new InputError("Release state architecture mismatch");
      if (state.sourceSha !== context.sha)
        throw new InputError("Release state source SHA mismatch");
      await recordReleaseTag(
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
    const launchpadToken = required(env, "launchpad-token", 4_096);
    const storeToken = required(env, "store-token", 16_384);
    core.setSecret(launchpadToken);
    core.setSecret(storeToken);
    await runRelease(
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
