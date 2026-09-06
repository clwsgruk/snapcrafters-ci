import * as core from "@actions/core";
import { actionContext } from "../actions/context.js";
import { channel, optional, positiveDecimal, repository, required } from "../actions/inputs.js";
import { actionSignal } from "../actions/signal.js";
import { collectManifests } from "../manifests/collect.js";
import { parseProject } from "../project/parse.js";
import { issueCommenter, manifestGitHub, screenshotGitHub } from "../runtime/github.js";
import { captureScreenshots } from "./run.js";
import { publishScreenshots } from "./upload.js";

export async function runScreenshotsAction(env: NodeJS.ProcessEnv): Promise<void> {
  if (optional(env, "ci-repo", "snapcrafters/ci") !== "snapcrafters/ci")
    throw new Error("ci-repo overrides are deprecated; pin a fork action at an immutable SHA");
  const issueToken = required(env, "github-token", 4_096);
  const screenshotsToken = required(env, "screenshots-token", 4_096);
  core.setSecret(issueToken);
  core.setSecret(screenshotsToken);
  const context = await actionContext(env);
  const project = await parseProject(context.workspace, optional(env, "snapcraft-project-root"));
  const issue = positiveDecimal(required(env, "issue-number"), "issue-number");
  const screenshotsRepo = optional(env, "screenshots-repo", "snapcrafters/ci-screenshots");
  repository(screenshotsRepo);
  const cancellation = actionSignal();
  try {
    const manifests = await collectManifests(
      manifestGitHub(issueToken, context.repository, context.runId, cancellation.signal),
      context.workspace,
    );
    const images = await captureScreenshots({
      cwd: context.workspace,
      actionPath: env.GITHUB_ACTION_PATH ?? process.cwd(),
      snap: project.name,
      app: optional(env, "snap-application-name", project.name),
      channel: channel(optional(env, "channel", "latest/candidate")),
      manifests,
      signal: cancellation.signal,
    });
    const urls = await publishScreenshots(
      {
        repository: screenshotsRepo,
        sourceRepository: context.repository,
        snap: project.name,
        issue,
        date: new Date().toISOString().slice(0, 10).replaceAll("-", ""),
        ...images,
        author: {
          name: optional(env, "bot-name", "Snapcrafters Bot"),
          email: optional(env, "bot-email", "snapforge.team@gmail.com"),
        },
      },
      {
        github: screenshotGitHub(screenshotsToken, screenshotsRepo, cancellation.signal),
        comment: issueCommenter(
          issueToken,
          context.repository,
          Number(issue),
          cancellation.signal,
        ),
        sleep: async (ms) => void (await new Promise((resolve) => setTimeout(resolve, ms))),
      },
    );
    core.setOutput("screen", urls.screen);
    core.setOutput("window", urls.window);
  } finally {
    cancellation.dispose();
  }
}
