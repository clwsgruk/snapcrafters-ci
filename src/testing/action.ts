import * as core from "@actions/core";
import { readFile } from "node:fs/promises";
import { actionContext } from "../actions/context.js";
import {
  architectureList,
  channel,
  optional,
  positiveDecimal,
  required,
} from "../actions/inputs.js";
import { actionSignal } from "../actions/signal.js";
import { collectManifests } from "../manifests/collect.js";
import { decodeManifest } from "../manifests/codec.js";
import { parseProject } from "../project/parse.js";
import type { Architecture } from "../project/types.js";
import { issueCommenter, issueCreator, manifestGitHub } from "../runtime/github.js";
import { runProcess } from "../runtime/process.js";
import { parseRevisions } from "../release/snapcraft.js";
import { createTestingIssue } from "./issue.js";
import { runTests } from "./run.js";

export async function runTestingIssueAction(env: NodeJS.ProcessEnv): Promise<void> {
  const token = required(env, "github-token", 4_096);
  core.setSecret(token);
  const context = await actionContext(env);
  const project = await parseProject(context.workspace, optional(env, "snapcraft-project-root"));
  const architectures = architectureList(required(env, "architectures"));
  const storeToken = optional(env, "store-token");
  if (storeToken) core.setSecret(storeToken);
  const cancellation = actionSignal();
  let installed = false;
  try {
    const manifests = await collectManifests(
      manifestGitHub(token, context.repository, context.runId, cancellation.signal),
      context.workspace,
      { snap: project.name, architectures, allowEmpty: true },
    );
    const number = await createTestingIssue(
      {
        ciRepo: optional(env, "ci-repo", "snapcrafters/ci"),
        snap: project.name,
        ...(project.version ? { version: project.version } : {}),
        channel: channel(optional(env, "channel", "latest/candidate")),
        promotionChannel: channel(optional(env, "promotion-channel", "latest/stable")),
        architectures,
        manifests,
        instructions: optional(env, "testing-instructions"),
      },
      {
        lookup: async (snap, architecture, releaseChannel) => {
          if (!storeToken) throw new Error("store-token is required when manifests are absent");
          if (!installed) {
            await successful({
              file: "sudo",
              args: [
                "snap",
                "install",
                "snapcraft",
                "--classic",
                "--channel",
                channel(optional(env, "snapcraft-channel", "latest/stable")),
              ],
              cwd: context.workspace,
              env: { PATH: process.env.PATH ?? "" },
              timeoutMs: 5 * 60_000,
              signal: cancellation.signal,
            });
            installed = true;
          }
          const result = await successful({
            file: "snapcraft",
            args: ["revisions", snap, "--arch", architecture],
            cwd: context.workspace,
            env: { PATH: process.env.PATH ?? "", SNAPCRAFT_STORE_CREDENTIALS: storeToken },
            timeoutMs: 2 * 60_000,
            signal: cancellation.signal,
            redact: [storeToken],
          });
          const found = parseRevisions(result.stdout, releaseChannel, architecture)[0];
          return found ? { revision: found.revision, version: found.version } : undefined;
        },
        createIssue: issueCreator(token, context.repository, cancellation.signal),
      },
    );
    core.setOutput("number", String(number));
  } finally {
    cancellation.dispose();
  }
}

export async function runTestsAction(env: NodeJS.ProcessEnv): Promise<void> {
  const token = required(env, "github-token", 4_096);
  core.setSecret(token);
  const context = await actionContext(env);
  const project = await parseProject(context.workspace, optional(env, "snapcraft-project-root"));
  const cancellation = actionSignal();
  try {
    const manifests = await collectManifests(
      manifestGitHub(token, context.repository, context.runId, cancellation.signal),
      context.workspace,
    );
    await installForRunner(
      project.name,
      context.workspace,
      channel(optional(env, "channel", "latest/candidate")),
      manifests,
      cancellation.signal,
    );
    const issue = Number(positiveDecimal(required(env, "issue-number"), "issue-number"));
    const result = await runTests(
      {
        cwd: context.workspace,
        script: required(env, "test-script", 1024 * 1024),
        runUrl: `https://github.com/${context.repository}/actions/runs/${context.runId}`,
        signal: cancellation.signal,
      },
      { comment: issueCommenter(token, context.repository, issue, cancellation.signal) },
    );
    if (result.commentError)
      core.warning(`Could not report test result: ${result.commentError.message}`);
    if (result.exitCode !== 0) throw new Error(`Tests failed with exit code ${result.exitCode}`);
  } finally {
    cancellation.dispose();
  }
}

async function installForRunner(
  snap: string,
  cwd: string,
  releaseChannel: string,
  manifests: readonly { name: string; architecture: Architecture; revision: string }[],
  signal: AbortSignal,
): Promise<void> {
  const architectureResult = await successful({
    file: "dpkg",
    args: ["--print-architecture"],
    cwd,
    env: { PATH: process.env.PATH ?? "" },
    timeoutMs: 30_000,
    signal,
  });
  const architecture = architectureResult.stdout.trim();
  const manifest = manifests.find((item) => item.architecture === architecture);
  let args = ["snap", "install", snap, "--channel", releaseChannel];
  if (manifest) {
    if (manifest.name !== snap) throw new Error("Manifest snap does not match project");
    args = ["snap", "install", snap, "--revision", manifest.revision];
  } else {
    const filename = `manifest-${architecture}.yaml`;
    try {
      const decoded = decodeManifest(await readFile(`${cwd}/${filename}`, "utf8"), filename);
      if (decoded.name !== snap) throw new Error("Manifest snap does not match project");
      args = ["snap", "install", snap, "--revision", decoded.revision];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  await successful({
    file: "sudo",
    args,
    cwd,
    env: { PATH: process.env.PATH ?? "" },
    timeoutMs: 5 * 60_000,
    signal,
  });
}

async function successful(spec: Parameters<typeof runProcess>[0]) {
  const result = await runProcess(spec);
  if (result.exitCode !== 0) throw new Error(`${spec.file} failed (${result.exitCode})`);
  return result;
}
