import { describe, expect, test } from "vite-plus/test";
import { PartialPublicationError } from "../runtime/errors.js";
import { type PromotionIssue, promote } from "./run.js";

const base = {
  eventName: "issue_comment",
  action: "created",
  repository: "apps/demo",
  issue: 4,
  actor: "maintainer",
  comment: "/promote 11,12 latest/stable done",
  configuredChannel: "latest/stable",
  snap: "demo",
  edited: false,
};

function body(command = "/promote 11,12 latest/stable done", snap = "demo"): string {
  return `A new version (1) of \`${snap}\` was just pushed to the \`latest/candidate\` channel.\n\n\`\`\`\n${command}\n\`\`\``;
}

function issue(overrides: Partial<PromotionIssue> = {}): PromotionIssue {
  return {
    repository: "apps/demo",
    body: body(),
    state: "open",
    isPullRequest: false,
    labels: ["testing"],
    ...overrides,
  };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    permission: async () => "write",
    react: async () => undefined,
    issue: async () => issue(),
    release: async () => undefined,
    comment: async () => undefined,
    close: async () => undefined,
    ...overrides,
  };
}

describe("promotion authorization and binding", () => {
  test("rejects ambiguous issue bodies containing multiple promotion records", async () => {
    let writes = 0;
    await expect(
      promote(
        { ...base, comment: "/promote 11 latest/stable" },
        dependencies({
          issue: async () =>
            issue({
              body: `${body("/promote 11 latest/stable done")}\n/promote 12 latest/stable done`,
            }),
          release: async () => {
            writes++;
          },
        }),
      ),
    ).rejects.toThrow(/ambiguous|single.*record/i);
    expect(writes).toBe(0);
  });

  test.each([
    issue({ state: "closed" }),
    issue({ isPullRequest: true }),
    issue({ labels: [] }),
    issue({ repository: "other/repo" }),
    issue({ body: body(undefined, "other") }),
  ])("rejects an unrelated issue before Store writes", async (invalidIssue) => {
    let writes = 0;
    await expect(
      promote(
        base,
        dependencies({
          issue: async () => invalidIssue,
          release: async () => {
            writes++;
          },
        }),
      ),
    ).rejects.toThrow(/issue|snap/i);
    expect(writes).toBe(0);
  });

  test("rejects edited comments and unauthorized actors before reaction or writes", async () => {
    let reactions = 0;
    await expect(
      promote(
        { ...base, edited: true },
        dependencies({
          react: async () => {
            reactions++;
          },
        }),
      ),
    ).rejects.toThrow(/edited/i);
    await expect(
      promote(
        base,
        dependencies({
          permission: async () => "read",
          react: async () => {
            reactions++;
          },
        }),
      ),
    ).rejects.toThrow(/permission/i);
    expect(reactions).toBe(0);
  });

  test("rejects one unrelated revision before every Store write", async () => {
    const writes: string[] = [];
    await expect(
      promote(
        base,
        dependencies({
          issue: async () => issue({ body: body("/promote 11 latest/stable done") }),
          release: async (revision: string) => {
            writes.push(revision);
          },
        }),
      ),
    ).rejects.toThrow(/unrelated.*12/i);
    expect(writes).toEqual([]);
  });

  test("reports exact sequential partial success and does not close", async () => {
    const comments: string[] = [];
    let closes = 0;
    const result = await promote(
      base,
      dependencies({
        release: async (revision: string) => {
          if (revision === "12") throw new Error("store down");
        },
        comment: async (value: string) => {
          comments.push(value);
        },
        close: async () => {
          closes++;
        },
      }),
    );
    expect(result).toEqual({ released: ["11"], failed: "12", closed: false });
    expect(comments[0]).toMatch(/11.*12/s);
    expect(closes).toBe(0);
  });

  test("preserves released revisions when success reporting fails", async () => {
    const operation = promote(
      base,
      dependencies({
        comment: async () => {
          throw new Error("GitHub unavailable");
        },
      }),
    );
    await expect(operation).rejects.toBeInstanceOf(PartialPublicationError);
    await expect(operation).rejects.toThrow(/released.*11,12.*report/i);
  });

  test("closes only after every release and verifies the closed state", async () => {
    const order: string[] = [];
    let closed = false;
    const result = await promote(
      base,
      dependencies({
        issue: async () => issue({ state: closed ? "closed" : "open" }),
        release: async (revision: string) => {
          order.push(`release:${revision}`);
        },
        comment: async () => {
          order.push("comment");
        },
        close: async () => {
          order.push("close");
          closed = true;
        },
      }),
    );
    expect(result).toEqual({ released: ["11", "12"], closed: true });
    expect(order).toEqual(["release:11", "release:12", "comment", "close"]);
  });

  test("reports a close readback failure with the released state", async () => {
    const operation = promote(base, dependencies());
    await expect(operation).rejects.toBeInstanceOf(PartialPublicationError);
    await expect(operation).rejects.toThrow(/released.*11,12.*close/i);
  });
});
