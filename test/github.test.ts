import { createServer } from "node:http";
import { expect, test } from "vitest";
import { request, marked } from "../src/github.ts";
test("explicit tokens and disconnect recovery create exactly one marked comment", async () => {
  const comments: { id: number; body: string }[] = [];
  let writes = 0;
  const server = createServer(async (req, res) => {
    expect(req.headers.authorization).toBe("Bearer issue-token");
    if (req.method === "GET" && req.url?.startsWith("/comments?")) {
      res.end(JSON.stringify(comments));
      return;
    }
    if (req.method === "POST" && req.url === "/comments") {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c);
      comments.push({ id: 1, body: JSON.parse(Buffer.concat(chunks).toString()).body });
      writes++;
      req.socket.destroy();
      return;
    }
    res.writeHead(403);
    res.end("denied");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    expect(await marked("/comments", { body: "hello" }, "m1", "issue-token", base)).toMatchObject({
      id: 1,
    });
    expect(await marked("/comments", { body: "hello" }, "m1", "issue-token", base)).toMatchObject({
      id: 1,
    });
    expect(writes).toBe(1);
    await expect(request("GET", "/forbidden", "issue-token", undefined, base)).rejects.toThrow(
      /403/,
    );
    await expect(request("GET", "/comments", "", undefined, base)).rejects.toThrow(/token/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("an existing deterministic marker with different content cannot impersonate a completed write", async () => {
  const server = createServer((req, res) => {
    if (req.method !== "GET") throw Error("unexpected write");
    res.end(JSON.stringify([{ id: 1, body: "tampered\n<!-- snapcrafters-ci:collision -->" }]));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await expect(
      marked("/comments", { body: "intended" }, "collision", "token", base),
    ).rejects.toThrow(/marker/i);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("HTTP deadlines are fresh per request and bodies/pagination are bounded", async () => {
  const { bounded, pages } = await import("../src/github.ts");
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    if (req.url === "/slow") return;
    if (req.url?.startsWith("/pages?"))
      res.end(JSON.stringify(Array.from({ length: 100 }, () => ({ id: 1 }))));
    else res.end('{"ok":true}');
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await expect(
      request("GET", "/slow", "token", undefined, base, Date.now() + 20),
    ).rejects.toThrow();
    expect(await request("GET", "/ok", "token", undefined, base)).toEqual({ ok: true });
    await expect(pages("/pages", "token", undefined, base)).rejects.toThrow(/Pagination/);
    expect(requests).toBe(12);
    await expect(bounded(new Response(Buffer.alloc(64)), 32)).rejects.toThrow(/size/);
    await expect(
      request("POST", "/ok", "token", { body: "x".repeat(17 * 1024 * 1024) }, base),
    ).rejects.toThrow(/size/);
    expect(requests).toBe(12);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
