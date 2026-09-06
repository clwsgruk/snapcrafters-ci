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
      const response = await readRequest(signal, 60_000, (requestSignal) =>
        client.rest.actions.downloadArtifact({
          owner,
          repo,
          artifact_id: id,
          archive_format: "zip",
          request: { signal: requestSignal },
        }),
      );
      return Buffer.from(response.data as ArrayBuffer);
    },
  };
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
    await writeRequest(signal, 30_000, (requestSignal) =>
      client.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body,
        request: { signal: requestSignal },
      }),
    );
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
  };
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
      await writeRequest(signal, 60_000, (requestSignal) =>
        client.rest.issues.createComment({
          owner,
          repo,
          issue_number: issueNumber,
          body,
          request: { signal: requestSignal },
        }),
      );
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
