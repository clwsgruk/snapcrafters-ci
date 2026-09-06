import { InputError } from "../runtime/errors.js";
import { retryDelay, systemClock, type Clock } from "../runtime/clock.js";
import { retryAfterMilliseconds } from "../runtime/retry.js";

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
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(input.snap) || !/^[1-9][0-9]*$/.test(input.issue)) {
    throw new InputError("Invalid screenshot snap or issue");
  }
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
  if (input.screen.length > 10 * 1024 * 1024 || input.window.length > 10 * 1024 * 1024) {
    throw new InputError("Screenshot exceeds size limit");
  }
  validatePng(input.screen);
  validatePng(input.window);
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
        `data: screenshots for ${input.sourceRepository}/${input.snap}#${input.issue}`,
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

function gitSha(value: string, label: string): string {
  if (!/^[0-9a-f]{40}$/.test(value)) throw new InputError(`Invalid Git ${label} SHA`);
  return value;
}

function validatePng(value: Buffer): void {
  if (
    value.length < 8 ||
    !value.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new InputError("Screenshot must be a non-empty PNG image");
}

function confirmedRefConflict(error: unknown): boolean {
  const status = (error as { status?: number }).status;
  const message = error instanceof Error ? error.message : "";
  return (
    (status === 409 && /conflict/i.test(message)) ||
    (status === 422 && /reference update failed|not a fast forward/i.test(message))
  );
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
