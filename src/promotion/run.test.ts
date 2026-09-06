import { describe, expect, test } from "vite-plus/test";
import { PartialPublicationError } from "../runtime/errors.js";
import { promote } from "./run.js";

const base = {
  eventName: "issue_comment",
  action: "created",
  repository: "apps/demo",
  issue: 4,
  actor: "maintainer",
  comment: "/promote 11,12 latest/stable done",
  configuredChannel: "latest/stable",
};

describe("promotion authorization and binding", () => {
  test("rejects one unrelated revision before every Store write", async () => {
    const writes: string[] = [];
    await expect(
      promote(base, {
        permission: async () => "write",
        issueBody: async () => "Built revisions\n/promote 11 latest/stable done",
        release: async (revision) => {
          writes.push(revision);
        },
        comment: async () => undefined,
        close: async () => undefined,
      }),
    ).rejects.toThrow(/unrelated.*12/i);
    expect(writes).toEqual([]);
  });

  test("reports exact sequential partial success and does not close", async () => {
    const comments: string[] = [];
    let closes = 0;
    const result = await promote(base, {
      permission: async () => "admin",
      issueBody: async () => "/promote 11,12 latest/stable done",
      release: async (revision) => {
        if (revision === "12") throw new Error("store down");
      },
      comment: async (body) => {
        comments.push(body);
      },
      close: async () => {
        closes++;
      },
    });
    expect(result).toEqual({ released: ["11"], failed: "12", closed: false });
    expect(comments[0]).toMatch(/11.*12/s);
    expect(closes).toBe(0);
  });

  test.each(["read", "triage"])("rejects %s permission", async (permission) => {
    let writes = 0;
    await expect(
      promote(
        { ...base, comment: "/promote 11 latest/stable" },
        {
          permission: async () => permission,
          issueBody: async () => "/promote 11 latest/stable done",
          release: async () => {
            writes++;
          },
          comment: async () => undefined,
          close: async () => undefined,
        },
      ),
    ).rejects.toThrow(/permission/i);
    expect(writes).toBe(0);
  });

  test("binds every allowed revision to the configured channel before Store writes", async () => {
    let writes = 0;
    await expect(
      promote(
        { ...base, comment: "/promote 11 latest/stable" },
        {
          permission: async () => "write",
          issueBody: async () => "/promote 11 latest/candidate done",
          release: async () => {
            writes++;
          },
          comment: async () => undefined,
          close: async () => undefined,
        },
      ),
    ).rejects.toThrow(/unrelated.*11/i);
    expect(writes).toBe(0);
  });

  test("preserves released revisions when success reporting fails", async () => {
    const operation = promote(base, {
      permission: async () => "maintain",
      issueBody: async () => "/promote 11,12 latest/stable done",
      release: async () => undefined,
      comment: async () => {
        throw new Error("GitHub unavailable");
      },
      close: async () => undefined,
    });
    await expect(operation).rejects.toBeInstanceOf(PartialPublicationError);
    await expect(operation).rejects.toThrow(/released.*11,12.*report/i);
  });

  test("closes only after every validated release and its report succeed", async () => {
    const order: string[] = [];
    const result = await promote(base, {
      permission: async () => "admin",
      issueBody: async () => "/promote 11,12 latest/stable done",
      release: async (revision) => {
        order.push(`release:${revision}`);
      },
      comment: async () => {
        order.push("comment");
      },
      close: async () => {
        order.push("close");
      },
    });
    expect(result).toEqual({ released: ["11", "12"], closed: true });
    expect(order).toEqual(["release:11", "release:12", "comment", "close"]);
  });
});
