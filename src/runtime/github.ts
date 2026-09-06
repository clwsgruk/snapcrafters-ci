import { getOctokit } from "@actions/github";
import type { ManifestGitHub } from "../manifests/collect.js";
import type { ScreenshotGitHub } from "../screenshots/upload.js";
import { retryRequest, withDeadline } from "./retry.js";

function readRequest<T>(
  parent: AbortSignal,
  timeoutMs: number,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  return withDeadline(parent, timeoutMs, (signal) =>
    retryRequest(() => request(signal), { signal }),
  );
}

function writeRequest<T>(
  parent: AbortSignal,
  timeoutMs: number,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  return withDeadline(parent, timeoutMs, request);
}

export function manifestGitHub(
  token: string,
  repository: string,
  runId: string,
  signal: AbortSignal = new AbortController().signal,
  options: { fetcher?: typeof fetch; apiBase?: string } = {},
): ManifestGitHub {
  const [owner, repo] = repository.split("/") as [string, string];
  const client = getOctokit(token);
  return {
    async listArtifacts(page) {
      const response = await readRequest(signal, 60_000, (requestSignal) =>
        client.rest.actions.listWorkflowRunArtifacts({
          owner,
          repo,
          run_id: Number(runId),
          per_page: 100,
          page,
          request: { signal: requestSignal },
        }),
      );
      return {
        artifacts: response.data.artifacts.map((item) => ({
          id: item.id,
          name: item.name,
          expired: item.expired,
        })),
        hasNext: response.data.artifacts.length === 100,
      };
    },
    async downloadArtifact(id) {
      return readRequest(signal, 60_000, async (requestSignal) => {
        const response = await (options.fetcher ?? fetch)(
          `${options.apiBase ?? "https://api.github.com"}/repos/${owner}/${repo}/actions/artifacts/${id}/zip`,
          {
            headers: {
              accept: "application/vnd.github+json",
              authorization: `Bearer ${token}`,
              "user-agent": "snapcrafters-ci",
              "x-github-api-version": "2022-11-28",
            },
            redirect: "follow",
            signal: requestSignal,
          },
        );
        if (!response.ok)
          throw Object.assign(new Error(`Artifact download failed (${response.status})`), {
            status: response.status,
          });
        return readBoundedResponse(response, 5 * 1024 * 1024);
      });
    },
  };
}

async function readBoundedResponse(response: Response, limit: number): Promise<Buffer> {
  const declared = response.headers.get("content-length");
  if (declared && (!/^[0-9]+$/.test(declared) || Number(declared) > limit))
    throw new Error("Artifact response exceeds size limit");
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("Artifact response exceeds size limit");
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export function issueCommenter(
  token: string,
  repository: string,
  issueNumber: number,
  signal: AbortSignal = new AbortController().signal,
) {
  const [owner, repo] = repository.split("/") as [string, string];
  const client = getOctokit(token);
  return async (body: string): Promise<void> => {
    const marker = deliveryMarker(body);
    const exists = async (): Promise<boolean> => {
      if (!marker) return false;
      for (let page = 1; page <= 10; page++) {
        const response = await readRequest(signal, 30_000, (requestSignal) =>
          client.rest.issues.listComments({
            owner,
            repo,
            issue_number: issueNumber,
            per_page: 100,
            page,
            request: { signal: requestSignal },
          }),
        );
        if (response.data.some((comment) => comment.body?.includes(marker))) return true;
        if (response.data.length < 100) return false;
      }
      throw new Error("Issue comment pagination limit exceeded");
    };
    if (await exists()) return;
    try {
      await writeRequest(signal, 30_000, (requestSignal) =>
        client.rest.issues.createComment({
          owner,
          repo,
          issue_number: issueNumber,
          body,
          request: { signal: requestSignal },
        }),
      );
    } catch (error) {
      if (await exists()) return;
      throw error;
    }
  };
}

export function issueCreator(
  token: string,
  repository: string,
  signal: AbortSignal = new AbortController().signal,
) {
  const [owner, repo] = repository.split("/") as [string, string];
  const client = getOctokit(token);
  return async (title: string, body: string, labels: string[]): Promise<number> => {
    const marker = deliveryMarker(body);
    const find = async (): Promise<number | undefined> => {
      if (!marker) return undefined;
      for (let page = 1; page <= 10; page++) {
        const response = await readRequest(signal, 30_000, (requestSignal) =>
          client.rest.issues.listForRepo({
            owner,
            repo,
            state: "all",
            per_page: 100,
            page,
            request: { signal: requestSignal },
          }),
        );
        const found = response.data.find(
          (issue) => !issue.pull_request && issue.body?.includes(marker),
        );
        if (found) return found.number;
        if (response.data.length < 100) return undefined;
      }
      throw new Error("Issue pagination limit exceeded");
    };
    const existing = await find();
    if (existing) return existing;
    try {
      const response = await writeRequest(signal, 30_000, (requestSignal) =>
        client.rest.issues.create({
          owner,
          repo,
          title,
          body,
          labels,
          request: { signal: requestSignal },
        }),
      );
      return response.data.number;
    } catch (error) {
      const recovered = await find();
      if (recovered) return recovered;
      throw error;
    }
  };
}

function deliveryMarker(body: string): string | undefined {
  const matches = body.match(/<!-- snapcrafters-ci:[a-z-]+:[A-Za-z0-9:._/-]+ -->/g) ?? [];
  if (matches.length > 1) throw new Error("Ambiguous delivery marker");
  return matches[0];
}

export function screenshotGitHub(
  token: string,
  repository: string,
  signal: AbortSignal = new AbortController().signal,
): ScreenshotGitHub {
  const [owner, repo] = repository.split("/") as [string, string];
  const client = getOctokit(token);
  return {
    async getRef() {
      return (
        await readRequest(signal, 60_000, (requestSignal) =>
          client.rest.git.getRef({
            owner,
            repo,
            ref: "heads/main",
            request: { signal: requestSignal },
          }),
        )
      ).data.object.sha;
    },
    async getCommitTree(sha) {
      return (
        await readRequest(signal, 60_000, (requestSignal) =>
          client.rest.git.getCommit({
            owner,
            repo,
            commit_sha: sha,
            request: { signal: requestSignal },
          }),
        )
      ).data.tree.sha;
    },
    async createBlob(content) {
      return (
        await writeRequest(signal, 60_000, (requestSignal) =>
          client.rest.git.createBlob({
            owner,
            repo,
            content: content.toString("base64"),
            encoding: "base64",
            request: { signal: requestSignal },
          }),
        )
      ).data.sha;
    },
    async createTree(baseTree, entries) {
      return (
        await writeRequest(signal, 60_000, (requestSignal) =>
          client.rest.git.createTree({
            owner,
            repo,
            base_tree: baseTree,
            tree: entries.map((entry) => ({
              path: entry.path,
              sha: entry.sha,
              mode: "100644",
              type: "blob",
            })),
            request: { signal: requestSignal },
          }),
        )
      ).data.sha;
    },
    async createCommit(tree, parent, message, author) {
      return (
        await writeRequest(signal, 60_000, (requestSignal) =>
          client.rest.git.createCommit({
            owner,
            repo,
            tree,
            parents: [parent],
            message,
            author,
            committer: author,
            request: { signal: requestSignal },
          }),
        )
      ).data.sha;
    },
    async updateRef(sha) {
      await writeRequest(signal, 60_000, (requestSignal) =>
        client.rest.git.updateRef({
          owner,
          repo,
          ref: "heads/main",
          sha,
          force: false,
          request: { signal: requestSignal },
        }),
      );
    },
    async isAncestor(ancestor, descendant) {
      const response = await readRequest(signal, 60_000, (requestSignal) =>
        client.rest.repos.compareCommitsWithBasehead({
          owner,
          repo,
          basehead: `${ancestor}...${descendant}`,
          request: { signal: requestSignal },
        }),
      );
      return response.data.status === "ahead" || response.data.status === "identical";
    },
  };
}

export function promotionGitHub(
  token: string,
  repository: string,
  issueNumber: number,
  commentId: number,
  signal: AbortSignal = new AbortController().signal,
) {
  const [owner, repo] = repository.split("/") as [string, string];
  const client = getOctokit(token);
  return {
    async permission(actor: string): Promise<string> {
      return (
        await readRequest(signal, 60_000, (requestSignal) =>
          client.rest.repos.getCollaboratorPermissionLevel({
            owner,
            repo,
            username: actor,
            request: { signal: requestSignal },
          }),
        )
      ).data.permission;
    },
    async react(): Promise<void> {
      await writeRequest(signal, 60_000, (requestSignal) =>
        client.rest.reactions.createForIssueComment({
          owner,
          repo,
          comment_id: commentId,
          content: "eyes",
          request: { signal: requestSignal },
        }),
      );
    },
    async issue() {
      const data = (
        await readRequest(signal, 60_000, (requestSignal) =>
          client.rest.issues.get({
            owner,
            repo,
            issue_number: issueNumber,
            request: { signal: requestSignal },
          }),
        )
      ).data;
      return {
        repository,
        body: data.body ?? "",
        state: data.state === "closed" ? ("closed" as const) : ("open" as const),
        isPullRequest: Boolean(data.pull_request),
        labels: data.labels.map((label) =>
          typeof label === "string" ? label : (label.name ?? ""),
        ),
      };
    },
    async comment(body: string): Promise<void> {
      await issueCommenter(token, repository, issueNumber, signal)(body);
    },
    async close(): Promise<void> {
      await writeRequest(signal, 60_000, (requestSignal) =>
        client.rest.issues.update({
          owner,
          repo,
          issue_number: issueNumber,
          state: "closed",
          request: { signal: requestSignal },
        }),
      );
    },
  };
}
