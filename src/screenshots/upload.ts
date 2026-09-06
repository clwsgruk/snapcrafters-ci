import { InputError } from "../runtime/errors.js";

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
}

export async function uploadScreenshots(
  input: ScreenshotUpload,
  deps: { github: ScreenshotGitHub; sleep(ms: number): Promise<void> },
): Promise<{ screen: string; window: string }> {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(input.snap) || !/^[1-9][0-9]*$/.test(input.issue)) {
    throw new InputError("Invalid screenshot snap or issue");
  }
  if (!validRepository(input.repository) || !validRepository(input.sourceRepository))
    throw new InputError("Invalid screenshot repository");
  if (!validDate(input.date)) throw new InputError("Invalid screenshot date");
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
  const prefix = `${input.date}-${input.snap}-${input.issue}`;
  const entries = [
    { path: `${prefix}-screen.png`, sha: await deps.github.createBlob(input.screen) },
    { path: `${prefix}-window.png`, sha: await deps.github.createBlob(input.window) },
  ];
  let commit = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const parent = await deps.github.getRef();
    const base = await deps.github.getCommitTree(parent);
    const tree = await deps.github.createTree(base, entries);
    commit = await deps.github.createCommit(
      tree,
      parent,
      `data: screenshots for ${input.sourceRepository}/${input.snap}#${input.issue}`,
      input.author,
    );
    try {
      await deps.github.updateRef(commit);
      break;
    } catch (error) {
      const current = await deps.github.getRef();
      if (current === commit) break;
      const status = (error as { status?: number }).status;
      if (current === parent || (status !== 409 && status !== 422)) throw error;
      if (attempt === 2)
        throw new Error("Screenshot ref conflict retry limit exhausted", { cause: error });
      await deps.sleep(100 * (attempt + 1));
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
    sleep(ms: number): Promise<void>;
  },
): Promise<{ screen: string; window: string }> {
  const urls = await uploadScreenshots(input, deps);
  const body = `The following screenshots were taken during automated testing:\n\n![window](${urls.window})\n\n![screen](${urls.screen})`;
  for (let attempt = 0; ; attempt++) {
    try {
      await deps.comment(body);
      return urls;
    } catch (error) {
      if (attempt >= 2)
        throw new Error("Screenshot comment retry limit exhausted", { cause: error });
      await deps.sleep(100 * (attempt + 1));
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
