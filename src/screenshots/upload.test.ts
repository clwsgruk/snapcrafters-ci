import { expect, test } from "vite-plus/test";
import { publishScreenshots, uploadScreenshots } from "./upload.js";

test("uploads two blobs in one commit and retries a confirmed non-force ref conflict", async () => {
  let parent = "p1";
  let updates = 0;
  const trees: unknown[] = [];
  const result = await uploadScreenshots(
    {
      repository: "shots/repo",
      sourceRepository: "apps/demo",
      snap: "demo",
      issue: "7",
      date: "20260906",
      screen: Buffer.from("screen"),
      window: Buffer.from("window"),
      author: { name: "bot", email: "bot@example.invalid" },
    },
    {
      github: {
        getRef: async () => parent,
        getCommitTree: async (sha) => `tree-${sha}`,
        createBlob: async (data) => `blob-${data.toString()}`,
        createTree: async (base, entries) => {
          trees.push([base, entries]);
          return `tree-new-${base}`;
        },
        createCommit: async (_tree, current) => `commit-${current}`,
        updateRef: async (sha) => {
          updates++;
          if (updates === 1) {
            parent = "p2";
            throw Object.assign(new Error("conflict"), { status: 422 });
          }
          parent = sha;
        },
      },
      sleep: async () => undefined,
    },
  );
  expect(updates).toBe(2);
  expect(trees).toHaveLength(2);
  expect(result.screen).toContain("/commit-p2/");
  expect(result.window).toContain("/commit-p2/");
});

test("readback recovers disconnect after successful ref update without re-upload", async () => {
  let ref = "parent";
  let blobs = 0;
  const result = await uploadScreenshots(
    {
      repository: "shots/repo",
      sourceRepository: "apps/demo",
      snap: "demo",
      issue: "7",
      date: "20260906",
      screen: Buffer.from("s"),
      window: Buffer.from("w"),
      author: { name: "bot", email: "bot@example.invalid" },
    },
    {
      github: {
        getRef: async () => ref,
        getCommitTree: async () => "tree",
        createBlob: async () => `b${++blobs}`,
        createTree: async () => "newtree",
        createCommit: async () => "commit",
        updateRef: async () => {
          ref = "commit";
          throw new Error("disconnect");
        },
      },
      sleep: async () => undefined,
    },
  );
  expect(result.screen).toContain("/commit/");
  expect(blobs).toBe(2);
});

test("rejects invalid repositories and dates before creating either blob", async () => {
  let blobs = 0;
  await expect(
    uploadScreenshots(
      {
        repository: "bad repository",
        sourceRepository: "apps/demo",
        snap: "demo",
        issue: "7",
        date: "../../etc",
        screen: Buffer.from("s"),
        window: Buffer.from("w"),
        author: { name: "bot", email: "bot@example.invalid" },
      },
      {
        github: {
          getRef: async () => "parent",
          getCommitTree: async () => "tree",
          createBlob: async () => `b${++blobs}`,
          createTree: async () => "tree",
          createCommit: async () => "commit",
          updateRef: async () => undefined,
        },
        sleep: async () => undefined,
      },
    ),
  ).rejects.toThrow(/repository|date/i);
  expect(blobs).toBe(0);
});

test("retries only the issue comment after an immutable upload", async () => {
  let blobs = 0;
  let comments = 0;
  const urls = await publishScreenshots(
    {
      repository: "shots/repo",
      sourceRepository: "apps/demo",
      snap: "demo",
      issue: "7",
      date: "20260906",
      screen: Buffer.from("s"),
      window: Buffer.from("w"),
      author: { name: "bot", email: "bot@example.invalid" },
    },
    {
      github: {
        getRef: async () => "parent",
        getCommitTree: async () => "tree",
        createBlob: async () => `b${++blobs}`,
        createTree: async () => "newtree",
        createCommit: async () => "commit",
        updateRef: async () => undefined,
      },
      comment: async () => {
        if (++comments === 1) throw new Error("transient report failure");
      },
      sleep: async () => undefined,
    },
  );
  expect(urls.window).toContain("/commit/");
  expect({ blobs, comments }).toEqual({ blobs: 2, comments: 2 });
});
