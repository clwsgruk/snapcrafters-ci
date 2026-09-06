import { expect, test } from "vitest";
import { promoteCommand } from "../src/promotion.ts";
test("promotion accepts only the whole exact command", () => {
  expect(promoteCommand("/promote 12,9007199254740993 latest/stable done")).toEqual({
    revisions: ["12", "9007199254740993"],
    channel: "latest/stable",
    done: true,
  });
  for (const body of [
    "/promote 12 latest/stable\n",
    "/promote 12 latest/stable;id",
    "hi /promote 12 latest/stable",
    "/promote 12,12 latest/stable",
    "/promote 0 latest/stable",
    "/promote 12 stable",
    "/promote 12 latest/stable done now",
  ])
    expect(() => promoteCommand(body)).toThrow();
});

test("promotion rejects any unrelated revision before all writes, then releases and closes with replay", async () => {
  const { promote } = await import("../src/promotion.ts");
  const { testingBody } = await import("../src/testing.ts");
  const { createServer } = await import("node:http");
  const fs = await import("node:fs"),
    os = await import("node:os"),
    path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "promote-")),
    flag = path.join(dir, "released"),
    calls = path.join(dir, "calls");
  fs.writeFileSync(
    path.join(dir, "snapcraft"),
    `#!${process.execPath}\nconst fs=require('node:fs'),a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(a)+'\\n');if(JSON.stringify(a)===JSON.stringify(['revisions','sample','--arch','amd64'])) console.log('Rev. Uploaded Arches Version Channels\\n12 2026-09-06T00:00:00Z amd64 2 '+(fs.existsSync(${JSON.stringify(flag)})?'latest/stable*':'latest/candidate*'));else if(JSON.stringify(a)===JSON.stringify(['release','sample','12','latest/stable']))fs.writeFileSync(${JSON.stringify(flag)},'yes');else process.exit(90);`,
    { mode: 0o700 },
  );
  let permission = "write",
    edited = false,
    denyComment = false;
  let body = "/promote 12,999 latest/stable done",
    closed = false,
    writes = 0;
  const comments: { id: number; body: string }[] = [],
    reactions: { content: string; user: { id: number } }[] = [];
  const issue = {
    number: 1,
    pull_request: undefined as unknown,
    state: "open",
    labels: [{ name: "testing" }],
    body: testingBody(
      {
        repository: "owner/repo",
        snap: "sample",
        channel: "latest/candidate",
        destination: "latest/stable",
        version: "2",
        rows: [{ name: "sample", architecture: "amd64", revision: "12" }],
      },
      "Try it",
    ),
  };
  const comment = () => ({
    id: 7,
    body,
    user: { login: "maintainer" },
    created_at: "2026-09-06T00:00:00Z",
    updated_at: edited ? "2026-09-06T00:01:00Z" : "2026-09-06T00:00:00Z",
  });
  const server = createServer(async (req, res) => {
    expect(req.headers.authorization).toBe("Bearer issue-token");
    let data = {};
    if (req.method !== "GET") {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c);
      data = JSON.parse(Buffer.concat(chunks).toString());
      writes++;
    }
    if (req.url === "/repos/owner/repo/issues/comments/7") res.end(JSON.stringify(comment()));
    else if (req.url === "/repos/owner/repo/collaborators/maintainer/permission")
      res.end(JSON.stringify({ permission }));
    else if (req.url === "/user") res.end('{"id":3}');
    else if (req.url === "/repos/owner/repo/issues/1") {
      if (req.method === "PATCH") closed = true;
      res.end(JSON.stringify({ ...issue, state: closed ? "closed" : "open" }));
    } else if (req.url?.startsWith("/repos/owner/repo/issues/1/comments")) {
      if (req.method === "POST") {
        if (denyComment) {
          res.writeHead(403);
          res.end("{}");
          return;
        }
        const row = { id: 8, ...data };
        comments.push(row as { id: number; body: string });
        res.end(JSON.stringify(row));
      } else res.end(JSON.stringify(comments));
    } else if (req.url?.startsWith("/repos/owner/repo/issues/comments/7/reactions")) {
      if (req.method === "POST") {
        reactions.push({ content: "+1", user: { id: 3 } });
        res.end("{}");
      } else res.end(JSON.stringify(reactions));
    } else {
      res.writeHead(403);
      res.end("{}");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    old = process.env.PATH;
  process.env.PATH = `${dir}:${old}`;
  const event = () => ({
    action: "created",
    repository: { full_name: "owner/repo" },
    sender: { login: "maintainer" },
    issue: { number: 1 },
    comment: comment(),
  });
  try {
    await expect(
      promote(event(), "owner/repo", "sample", "latest/stable", "issue-token", "store-token", base),
    ).rejects.toThrow(/unrelated/i);
    expect(writes).toBe(0);
    expect(fs.existsSync(flag)).toBe(false);
    body = "/promote 12 latest/stable done";
    permission = "read";
    await expect(
      promote(event(), "owner/repo", "sample", "latest/stable", "issue-token", "store-token", base),
    ).rejects.toThrow(/permission/);
    permission = "write";
    edited = true;
    await expect(
      promote(event(), "owner/repo", "sample", "latest/stable", "issue-token", "store-token", base),
    ).rejects.toThrow(/unedited/);
    edited = false;
    issue.pull_request = {};
    await expect(
      promote(event(), "owner/repo", "sample", "latest/stable", "issue-token", "store-token", base),
    ).rejects.toThrow(/non-PR/);
    issue.pull_request = undefined;
    expect(writes).toBe(0);
    expect(fs.existsSync(flag)).toBe(false);
    denyComment = true;
    await expect(
      promote(event(), "owner/repo", "sample", "latest/stable", "issue-token", "store-token", base),
    ).rejects.toThrow(/Promoted revisions: 12/);
    expect(closed).toBe(false);
    expect(fs.existsSync(flag)).toBe(true);
    denyComment = false;

    await promote(
      event(),
      "owner/repo",
      "sample",
      "latest/stable",
      "issue-token",
      "store-token",
      base,
    );
    expect(closed).toBe(true);
    expect(fs.existsSync(flag)).toBe(true);
    expect(comments).toHaveLength(1);
    expect(
      fs
        .readFileSync(calls, "utf8")
        .split("\n")
        .filter((s) => s.includes('"release"')),
    ).toHaveLength(1);
  } finally {
    process.env.PATH = old;
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(dir, { recursive: true });
  }
});
