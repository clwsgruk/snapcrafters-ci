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
