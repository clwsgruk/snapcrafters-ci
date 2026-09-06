import { getOctokit } from "@actions/github";
import type { ManifestGitHub } from "../manifests/collect.js";
import type { ScreenshotGitHub } from "../screenshots/upload.js";
import { retryRequest } from "./retry.js";

export function manifestGitHub(
  token: string,
  repository: string,
  runId: string,
  signal: AbortSignal = new AbortController().signal,
): ManifestGitHub {
  const [owner, repo] = repository.split("/") as [string, string];
  const client = getOctokit(token);
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  return {
    async listArtifacts(page) {
      const response = await retryRequest(
        () =>
          client.rest.actions.listWorkflowRunArtifacts({
            owner,
            repo,
            run_id: Number(runId),
            per_page: 100,
            page,
            request: { signal: requestSignal },
          }),
        { signal: requestSignal },
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
      const response = await retryRequest(
        () =>
          client.rest.actions.downloadArtifact({
            owner,
            repo,
            artifact_id: id,
            archive_format: "zip",
            request: { signal: requestSignal },
          }),
        { signal: requestSignal },
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
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  return async (body: string): Promise<void> => {
    await client.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
      request: { signal: requestSignal },
    });
  };
}

export function issueCreator(
  token: string,
  repository: string,
  signal: AbortSignal = new AbortController().signal,
) {
  const [owner, repo] = repository.split("/") as [string, string];
  const client = getOctokit(token);
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  return async (title: string, body: string, labels: string[]): Promise<number> => {
    const response = await client.rest.issues.create({
      owner,
      repo,
      title,
      body,
      labels,
      request: { signal: requestSignal },
    });
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
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  return {
    async getRef() {
      return (
        await retryRequest(
          () =>
            client.rest.git.getRef({
              owner,
              repo,
              ref: "heads/main",
              request: { signal: requestSignal },
            }),
          { signal: requestSignal },
        )
      ).data.object.sha;
    },
    async getCommitTree(sha) {
      return (
        await retryRequest(
          () =>
            client.rest.git.getCommit({
              owner,
              repo,
              commit_sha: sha,
              request: { signal: requestSignal },
            }),
          { signal: requestSignal },
        )
      ).data.tree.sha;
    },
    async createBlob(content) {
      return (
        await client.rest.git.createBlob({
          owner,
          repo,
          content: content.toString("base64"),
          encoding: "base64",
          request: { signal: requestSignal },
        })
      ).data.sha;
    },
    async createTree(baseTree, entries) {
      return (
        await client.rest.git.createTree({
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
        })
      ).data.sha;
    },
    async createCommit(tree, parent, message, author) {
      return (
        await client.rest.git.createCommit({
          owner,
          repo,
          tree,
          parents: [parent],
          message,
          author,
          committer: author,
          request: { signal: requestSignal },
        })
      ).data.sha;
    },
    async updateRef(sha) {
      await client.rest.git.updateRef({
        owner,
        repo,
        ref: "heads/main",
        sha,
        force: false,
        request: { signal: requestSignal },
      });
    },
    async isAncestor(ancestor, descendant) {
      const response = await retryRequest(
        () =>
          client.rest.repos.compareCommitsWithBasehead({
            owner,
            repo,
            basehead: `${ancestor}...${descendant}`,
            request: { signal: requestSignal },
          }),
        { signal: requestSignal },
      );
      return response.data.status === "ahead" || response.data.status === "identical";
    },
  };
}

export function promotionGitHub(
  token: string,
  repository: string,
  issueNumber: number,
  signal: AbortSignal = new AbortController().signal,
) {
  const [owner, repo] = repository.split("/") as [string, string];
  const client = getOctokit(token);
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  return {
    async permission(actor: string): Promise<string> {
      return (
        await retryRequest(
          () =>
            client.rest.repos.getCollaboratorPermissionLevel({
              owner,
              repo,
              username: actor,
              request: { signal: requestSignal },
            }),
          { signal: requestSignal },
        )
      ).data.permission;
    },
    async issueBody(): Promise<string> {
      return (
        (
          await retryRequest(
            () =>
              client.rest.issues.get({
                owner,
                repo,
                issue_number: issueNumber,
                request: { signal: requestSignal },
              }),
            { signal: requestSignal },
          )
        ).data.body ?? ""
      );
    },
    async comment(body: string): Promise<void> {
      await client.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body,
        request: { signal: requestSignal },
      });
    },
    async close(): Promise<void> {
      await client.rest.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        state: "closed",
        request: { signal: requestSignal },
      });
    },
  };
}
