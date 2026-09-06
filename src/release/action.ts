import * as core from "@actions/core";
import { readFile, unlink, writeFile } from "node:fs/promises";
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

type ReleaseState = Awaited<ReturnType<typeof runRelease>>["published"];

export async function runReleaseAction(env: NodeJS.ProcessEnv): Promise<void> {
  const context = await actionContext(env);
  const target = architecture(required(env, "architecture"));
  const statePath = join(context.workspace, `.snapcrafters-release-${target}.json`);
  const cancellation = actionSignal();
  try {
    if (env.SNAPCRAFTERS_PHASE === "tag") {
      const requested = positiveDecimal(required(env, "published-revision"), "revision");
      const state = parseReleaseState(await readFile(statePath, "utf8"));
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

function parseReleaseState(source: string): ReleaseState {
  if (Buffer.byteLength(source) > 4_096) throw new InputError("Release state exceeds size limit");
  const value = JSON.parse(source) as Record<string, unknown>;
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.snap !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,39}$/.test(value.snap) ||
    typeof value.version !== "string" ||
    !value.version ||
    value.version.includes("\n") ||
    typeof value.revision !== "string" ||
    !/^[1-9][0-9]*$/.test(value.revision) ||
    typeof value.channel !== "string" ||
    typeof value.architecture !== "string" ||
    typeof value.digest !== "string" ||
    !/^[0-9a-f]{96}$/.test(value.digest) ||
    typeof value.sourceSha !== "string" ||
    !/^[0-9a-f]{40}$/.test(value.sourceSha)
  )
    throw new InputError("Invalid release state");
  architecture(value.architecture);
  channel(value.channel);
  return value as unknown as ReleaseState;
}
