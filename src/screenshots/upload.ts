import { retryDelay, systemClock, type Clock } from "../runtime/clock.js";
import { retryAfterMilliseconds } from "../runtime/retry.js";
import { confirmedRefConflict, gitSha, validateScreenshotUpload } from "./validation.js";

export interface ScreenshotGitHub {
  getRef(): Promise<string>;
  getCommitTree(sha: string): Promise<string>;
  createBlob(content: Buffer): Promise<string>;
  createTree(baseTree: string, entries: Array<{ path: string; sha: string }>): Promise<string>;
  createCommit(
    tree: string,
    parent: string,
    message: string,
    author: { name: string; email: string },
  ): Promise<string>;
  updateRef(sha: string): Promise<void>;
  isAncestor(ancestor: string, descendant: string): Promise<boolean>;
}

export interface ScreenshotUpload {
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
}

export async function uploadScreenshots(
  input: ScreenshotUpload,
  deps: {
    github: ScreenshotGitHub;
    clock?: Clock;
    random?: () => number;
    signal?: AbortSignal;
  },
): Promise<{ screen: string; window: string }> {
  const clock = deps.clock ?? systemClock;
  const signal = deps.signal ?? new AbortController().signal;
  const random = deps.random ?? Math.random;
  validateScreenshotUpload(input);
  const prefix = `${input.date}-${input.snap}-${input.issue}`;
  const entries = [
    {
      path: `${prefix}-screen.png`,
      sha: gitSha(await deps.github.createBlob(input.screen), "blob"),
    },
    {
      path: `${prefix}-window.png`,
      sha: gitSha(await deps.github.createBlob(input.window), "blob"),
    },
  ];
  let commit = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const parent = gitSha(await deps.github.getRef(), "ref");
    const base = gitSha(await deps.github.getCommitTree(parent), "tree");
    const tree = gitSha(await deps.github.createTree(base, entries), "tree");
    commit = gitSha(
      await deps.github.createCommit(
        tree,
        parent,
        `data: screenshots for ${input.sourceRepository}/${input.snap}#${input.issue} at ${input.sourceSha}`,
        input.author,
      ),
      "commit",
    );
    try {
      await deps.github.updateRef(commit);
      const current = gitSha(await deps.github.getRef(), "ref readback");
      if (current !== commit && !(await deps.github.isAncestor(commit, current)))
        throw new Error("Screenshot ref update could not be confirmed");
      break;
    } catch (error) {
      const current = gitSha(await deps.github.getRef(), "ref readback");
      if (current === commit || (await deps.github.isAncestor(commit, current))) break;
      if (current === parent || !confirmedRefConflict(error)) throw error;
      if (attempt === 2)
        throw new Error("Screenshot ref conflict retry limit exhausted", { cause: error });
      const retryAfter = retryAfterMilliseconds(error, clock.now());
      await clock.sleep(retryDelay(attempt, retryAfter, random), signal);
    }
  }
  const baseUrl = `https://raw.githubusercontent.com/${input.repository}/${commit}`;
  return { screen: `${baseUrl}/${entries[0]!.path}`, window: `${baseUrl}/${entries[1]!.path}` };
}

export async function publishScreenshots(
  input: ScreenshotUpload,
  deps: {
    github: ScreenshotGitHub;
    comment(body: string): Promise<void>;
    clock?: Clock;
    random?: () => number;
    signal?: AbortSignal;
  },
): Promise<{ screen: string; window: string }> {
  const urls = await uploadScreenshots(input, deps);
  const body = `The following screenshots were taken during automated testing:\n\n![window](${urls.window})\n\n![screen](${urls.screen})\n\n<!-- snapcrafters-ci:screenshot:${input.runId}:${input.sourceSha} -->`;
  for (let attempt = 0; ; attempt++) {
    try {
      await deps.comment(body);
      return urls;
    } catch (error) {
      if (attempt >= 2)
        throw new Error("Screenshot comment retry limit exhausted", { cause: error });
      const status = (error as { status?: number }).status;
      if (status !== undefined && !new Set([429, 502, 503, 504]).has(status)) throw error;
      const clock = deps.clock ?? systemClock;
      await clock.sleep(
        retryDelay(
          attempt,
          retryAfterMilliseconds(error, clock.now()),
          deps.random ?? Math.random,
        ),
        deps.signal ?? new AbortController().signal,
      );
    }
  }
}
