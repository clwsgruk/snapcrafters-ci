import type { Clock } from "../runtime/clock.js";
import { expect, test } from "vite-plus/test";
import { publishScreenshots, type ScreenshotGitHub, uploadScreenshots } from "./upload.js";

const sha = (digit: string) => digit.repeat(40);
const png = (body: string) =>
  Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from(body)]);
const input = () => ({
  repository: "shots/repo",
  sourceRepository: "apps/demo",
  snap: "demo",
  issue: "7",
  date: "20260906",
  screen: png("screen"),
  window: png("window"),
  author: { name: "bot", email: "bot@example.invalid" },
  runId: "7",
  sourceSha: "a".repeat(40),
});

function client(overrides: Partial<ScreenshotGitHub> = {}): ScreenshotGitHub {
  return {
    getRef: async () => sha("1"),
    getCommitTree: async () => sha("2"),
    createBlob: async (content) => (content.equals(input().screen) ? sha("3") : sha("4")),
    createTree: async () => sha("5"),
    createCommit: async () => sha("6"),
    updateRef: async () => undefined,
    isAncestor: async () => false,
    ...overrides,
  };
}

function clock(delays: number[] = []): Clock {
  return { now: () => 0, sleep: async (ms) => void delays.push(ms) };
}

test("rejects invalid metadata and non-PNG images before GitHub writes", async () => {
  let writes = 0;
  const github = client({
    createBlob: async () => {
      writes++;
      return sha("3");
    },
  });
  await expect(
    uploadScreenshots({ ...input(), screen: Buffer.alloc(0) }, { github }),
  ).rejects.toThrow(/PNG|empty/i);
  await expect(uploadScreenshots({ ...input(), date: "20260230" }, { github })).rejects.toThrow(
    /date/i,
  );
  expect(writes).toBe(0);
});

test("uploads two blobs in one commit and confirms a successful ref update", async () => {
  let ref = sha("1");
  let blobs = 0;
  const result = await uploadScreenshots(input(), {
    github: client({
      getRef: async () => ref,
      createBlob: async () => [sha("3"), sha("4")][blobs++]!,
      updateRef: async (value) => {
        ref = value;
      },
    }),
  });
  expect({ blobs, ref }).toEqual({ blobs: 2, ref: sha("6") });
  expect(result.screen).toContain(`/${sha("6")}/`);
});

test("retries confirmed non-fast-forward contention without recreating blobs", async () => {
  let ref = sha("1");
  let blobs = 0;
  let updates = 0;
  const commits = [sha("6"), sha("7")];
  const result = await uploadScreenshots(input(), {
    github: client({
      getRef: async () => ref,
      createBlob: async () => [sha("3"), sha("4")][blobs++]!,
      createCommit: async () => commits[updates]!,
      updateRef: async (value) => {
        updates++;
        if (updates === 1) {
          ref = sha("2");
          throw Object.assign(new Error("Reference update failed"), { status: 422 });
        }
        ref = value;
      },
    }),
    clock: clock(),
    random: () => 0,
  });
  expect({ blobs, updates }).toEqual({ blobs: 2, updates: 2 });
  expect(result.window).toContain(`/${sha("7")}/`);
});

test("readback recovers a disconnect after the commit became reachable", async () => {
  let ref = sha("1");
  let updates = 0;
  const result = await uploadScreenshots(input(), {
    github: client({
      getRef: async () => ref,
      updateRef: async (value) => {
        updates++;
        ref = value;
        throw new Error("disconnect");
      },
    }),
  });
  expect(updates).toBe(1);
  expect(result.screen).toContain(`/${sha("6")}/`);
});

test("accepts an advanced ref only when the created commit is its ancestor", async () => {
  let reads = 0;
  const result = await uploadScreenshots(input(), {
    github: client({
      getRef: async () => (reads++ === 0 ? sha("1") : sha("8")),
      isAncestor: async (ancestor, descendant) => ancestor === sha("6") && descendant === sha("8"),
    }),
  });
  expect(result.screen).toContain(`/${sha("6")}/`);
});

test.each([
  Object.assign(new Error("HTTP 403"), { status: 403 }),
  Object.assign(new Error("Validation failed"), { status: 422 }),
])("does not retry an unconfirmed ref failure", async (failure) => {
  let updates = 0;
  await expect(
    uploadScreenshots(input(), {
      github: client({
        getRef: async () => (updates ? sha("2") : sha("1")),
        updateRef: async () => {
          updates++;
          throw failure;
        },
      }),
    }),
  ).rejects.toThrow(failure.message);
  expect(updates).toBe(1);
});

test("rejects malformed Git object identifiers", async () => {
  await expect(
    uploadScreenshots(input(), {
      github: client({ createBlob: async () => "not-a-sha" }),
    }),
  ).rejects.toThrow(/blob SHA/i);
});

test("retries only the issue comment after one immutable upload", async () => {
  let ref = sha("1");
  let blobs = 0;
  let comments = 0;
  const delays: number[] = [];
  const urls = await publishScreenshots(input(), {
    github: client({
      getRef: async () => ref,
      createBlob: async () => [sha("3"), sha("4")][blobs++]!,
      updateRef: async (value) => {
        ref = value;
      },
    }),
    comment: async () => {
      if (++comments === 1) throw new Error("transient");
    },
    clock: clock(delays),
    random: () => 0,
  });
  expect(urls.window).toContain(`/${sha("6")}/`);
  expect({ blobs, comments, delays: delays.length }).toEqual({ blobs: 2, comments: 2, delays: 1 });
});

test("does not retry an authorization failure while reporting screenshots", async () => {
  let ref = sha("1");
  let comments = 0;
  await expect(
    publishScreenshots(input(), {
      github: client({
        getRef: async () => ref,
        updateRef: async (value) => {
          ref = value;
        },
      }),
      comment: async () => {
        comments++;
        throw Object.assign(new Error("forbidden"), { status: 403 });
      },
    }),
  ).rejects.toThrow(/forbidden/i);
  expect(comments).toBe(1);
});
