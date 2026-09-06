import { expect, test, vi } from "vite-plus/test";

const observed = vi.hoisted(() => [] as string[]);
const requestSignals = vi.hoisted(() => [] as AbortSignal[]);
const remote = vi.hoisted(() => ({
  issues: [] as Array<{ number: number; body: string }>,
  comments: [] as Array<{ body: string }>,
  disconnectIssue: false,
  disconnectComment: false,
  issueWrites: 0,
  commentWrites: 0,
}));

vi.mock("@actions/github", () => ({
  getOctokit: (token: string) => {
    const call = (name: string) => observed.push(`${token}:${name}`);
    return {
      rest: {
        actions: {
          listWorkflowRunArtifacts: async () => {
            call("artifacts");
            return { data: { artifacts: [] } };
          },
          downloadArtifact: async () => {
            call("download");
            return { data: new ArrayBuffer(0) };
          },
        },
        issues: {
          listComments: async () => ({ data: remote.comments }),
          listForRepo: async () => ({ data: remote.issues }),
          createComment: async (options: { body: string; request: { signal: AbortSignal } }) => {
            call("comment");
            requestSignals.push(options.request.signal);
            remote.commentWrites++;
            remote.comments.push({ body: options.body });
            if (remote.disconnectComment) throw new Error("disconnect after comment");
          },
          create: async (options: { body: string }) => {
            call("issue");
            remote.issueWrites++;
            remote.issues.push({ number: 1, body: options.body });
            if (remote.disconnectIssue) throw new Error("disconnect after issue");
            return { data: { number: 1 } };
          },
          get: async () => {
            call("issue-body");
            return { data: { body: "/promote 1 latest/stable" } };
          },
          update: async () => {
            call("close");
          },
        },
        git: {
          getRef: async () => {
            call("ref");
            return { data: { object: { sha: "a" } } };
          },
          getCommit: async () => ({ data: { tree: { sha: "t" } } }),
          createBlob: async () => {
            call("blob");
            return { data: { sha: "b" } };
          },
          createTree: async () => ({ data: { sha: "t2" } }),
          createCommit: async () => ({ data: { sha: "c" } }),
          updateRef: async () => undefined,
        },
        repos: {
          getCollaboratorPermissionLevel: async () => {
            call("permission");
            return { data: { permission: "write" } };
          },
        },
      },
    };
  },
}));

import {
  issueCommenter,
  issueCreator,
  manifestGitHub,
  promotionGitHub,
  screenshotGitHub,
} from "./github.js";

test("routes artifact, issue, promotion, and screenshot calls through distinct supplied tokens", async () => {
  observed.length = 0;
  const signal = new AbortController().signal;
  await manifestGitHub("artifact-token", "owner/repo", "1", signal).listArtifacts(1);
  await issueCreator("issue-token", "owner/repo", signal)("title", "body", []);
  await issueCommenter("issue-token", "owner/repo", 1, signal)("body");
  await screenshotGitHub("screenshot-token", "shots/repo", signal).createBlob(Buffer.from("x"));
  await promotionGitHub("promotion-token", "owner/repo", 1, 2, signal).permission("actor");
  expect(observed).toEqual([
    "artifact-token:artifacts",
    "issue-token:issue",
    "issue-token:comment",
    "screenshot-token:blob",
    "promotion-token:permission",
  ]);
});

test("creates a fresh live deadline signal for each delayed write", async () => {
  requestSignals.length = 0;
  const comment = issueCommenter("issue-token", "owner/repo", 1, new AbortController().signal);
  await comment("first");
  await Promise.resolve();
  await comment("second");
  expect(requestSignals).toHaveLength(2);
  expect(requestSignals[0]).not.toBe(requestSignals[1]);
  expect(requestSignals.every((signal) => !signal.aborted)).toBe(true);
});

test("recovers issue and comment disconnects by deterministic marker readback", async () => {
  Object.assign(remote, {
    issues: [],
    comments: [],
    disconnectIssue: true,
    disconnectComment: true,
    issueWrites: 0,
    commentWrites: 0,
  });
  const signal = new AbortController().signal;
  const issueBody = `body\n<!-- snapcrafters-ci:issue:7:${"a".repeat(40)} -->`;
  const create = issueCreator("issue-token", "owner/repo", signal);
  await expect(create("title", issueBody, ["testing"])).resolves.toBe(1);
  await expect(create("title", issueBody, ["testing"])).resolves.toBe(1);
  const commentBody = `result\n<!-- snapcrafters-ci:test:7:${"a".repeat(40)} -->`;
  const comment = issueCommenter("issue-token", "owner/repo", 1, signal);
  await expect(comment(commentBody)).resolves.toBeUndefined();
  await expect(comment(commentBody)).resolves.toBeUndefined();
  expect({ issues: remote.issueWrites, comments: remote.commentWrites }).toEqual({
    issues: 1,
    comments: 1,
  });
  remote.disconnectIssue = false;
  remote.disconnectComment = false;
});
