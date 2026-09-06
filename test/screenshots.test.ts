import { expect, test } from "vitest";
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { png } from "../src/screenshots.ts";
export const pngBytes = () => {
  const b = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").copy(b);
  b.writeUInt32BE(1, 16);
  b.writeUInt32BE(1, 20);
  return b;
};
test("timestamp screenshot alias resolves only to same-directory owned regular PNG", () => {
  const dir = mkdtempSync(join(tmpdir(), "png-"));
  try {
    const file = "screenshot-screen-2026-09-06_120000.png";
    writeFileSync(join(dir, file), pngBytes());
    symlinkSync(file, join(dir, "screenshot-screen.png"));
    expect(png(dir, "screen")).toEqual(pngBytes());
    rmSync(join(dir, "screenshot-screen.png"));
    symlinkSync(`../${file}`, join(dir, "screenshot-screen.png"));
    expect(() => png(dir, "screen")).toThrow();
    rmSync(join(dir, "screenshot-screen.png"));
    writeFileSync(join(dir, "screenshot-screen.png"), "not png");
    expect(() => png(dir, "screen")).toThrow();
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test.each([
  "success",
  "disconnect",
  "conflict",
  "forbidden",
  "invalid",
  "invalid-moved",
  "exhausted",
])("atomic screenshot upload: %s", async (mode) => {
  const { uploadScreenshots } = await import("../src/screenshots.ts");
  const { createServer } = await import("node:http");
  let head = "a".repeat(40),
    commits = 0,
    trees = 0,
    blobs = 0,
    updates = 0;
  const server = createServer(async (req, res) => {
    expect(req.headers.authorization).toBe("Bearer screenshot-token");
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    if (req.method === "GET" && req.url === "/repos/owner/images")
      res.end('{"default_branch":"main"}');
    else if (req.method === "GET" && req.url === "/repos/owner/images/git/ref/heads/main")
      res.end(JSON.stringify({ object: { sha: head } }));
    else if (req.method === "GET" && req.url?.startsWith("/repos/owner/images/git/commits/"))
      res.end(JSON.stringify({ tree: { sha: "b".repeat(40) } }));
    else if (req.method === "POST" && req.url?.endsWith("/blobs")) {
      blobs++;
      expect(body.encoding).toBe("base64");
      res.end(JSON.stringify({ sha: String(blobs).repeat(40) }));
    } else if (req.method === "POST" && req.url?.endsWith("/trees")) {
      trees++;
      expect(body.tree).toHaveLength(2);
      expect(body.base_tree).toBe("b".repeat(40));
      res.end(JSON.stringify({ sha: "c".repeat(40) }));
    } else if (req.method === "POST" && req.url?.endsWith("/commits")) {
      commits++;
      expect(body.parents).toEqual([head]);
      res.end(JSON.stringify({ sha: String(commits + 4).repeat(40) }));
    } else if (req.method === "PATCH" && req.url?.endsWith("/refs/heads/main")) {
      updates++;
      expect(body.force).toBe(false);
      if (mode === "forbidden" || mode === "invalid" || mode === "invalid-moved") {
        if (mode === "invalid-moved") head = "9".repeat(40);
        res.writeHead(mode === "forbidden" ? 403 : 422);
        res.end("{}");
      } else if (mode === "exhausted" || (mode === "conflict" && updates === 1)) {
        head = String(updates + 7).repeat(40);
        res.writeHead(422);
        res.end(JSON.stringify({ message: "Update is not a fast forward" }));
      } else {
        head = body.sha;
        if (mode === "disconnect") req.socket.destroy();
        else res.end("{}");
      }
    } else {
      res.writeHead(403);
      res.end("{}");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const promise = uploadScreenshots(
      {
        repo: "owner/images",
        token: "screenshot-token",
        snap: "sample",
        issue: "1",
        date: "2026-09-06",
        screen: pngBytes(),
        window: pngBytes(),
        name: "Bot",
        email: "bot@example.org",
      },
      base,
    );
    if (["forbidden", "invalid", "invalid-moved", "exhausted"].includes(mode))
      await expect(promise).rejects.toThrow();
    else {
      const urls = await promise;
      expect(urls.screen).toContain(`/${head}/`);
      expect(urls.window).toContain(`/${head}/`);
    }
    expect(blobs).toBe(2);
    expect(commits).toBe(mode === "exhausted" ? 3 : mode === "conflict" ? 2 : 1);
    expect(trees).toBe(commits);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("VM capture uses ghvmctl timestamp aliases and cleans its owned VM/HOME on failure", async () => {
  const { capture } = await import("../src/screenshots.ts");
  const dir = mkdtempSync(join(tmpdir(), "vm-")),
    log = join(dir, "calls");
  const fs = await import("node:fs");
  const source = `#!${process.execPath}\nconst fs=require('node:fs'),p=require('node:path'),a=process.argv.slice(2),tool=p.basename(process.argv[1]);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({tool,a,home:process.env.HOME,vm:process.env.VM_NAME})+'\\n');if(tool==='ghvmctl'&&a[0]==='prepare'&&a.length===1){}else if(tool==='ghvmctl'&&JSON.stringify(a)===JSON.stringify(['snap-install','sample','--channel','latest/candidate'])){}else if(tool==='ghvmctl'&&JSON.stringify(a)===JSON.stringify(['snap-run','sample.sample'])){}else if(tool==='ghvmctl'&&a[0]==='exec'&&a.length===2){}else if(tool==='ghvmctl'&&a[0]==='screenshot-full'&&a.length===1){const d=p.join(process.env.SNAP_REAL_HOME,'ghvmctl-screenshots');fs.mkdirSync(d);fs.writeFileSync(p.join(d,'screenshot-screen-2026-09-06_120000.png'),Buffer.from('${pngBytes().toString("base64")}','base64'));fs.symlinkSync('screenshot-screen-2026-09-06_120000.png',p.join(d,'screenshot-screen.png'));}else if(tool==='ghvmctl'&&a[0]==='screenshot-window')process.exit(2);else if(tool==='lxc'&&a[0]==='delete'&&a[1]==='--force'&&a[2]===process.env.VM_NAME&&a.length===3){}else process.exit(90);`;
  for (const name of ["ghvmctl", "lxc"]) writeFileSync(join(dir, name), source, { mode: 0o700 });
  const old = process.env.PATH;
  process.env.PATH = dir;
  try {
    await expect(capture("sample", "sample", "latest/candidate")).rejects.toThrow();
    const rows = fs
      .readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    expect(rows.at(-1).tool).toBe("lxc");
    expect(fs.existsSync(rows[0].home)).toBe(false);
    expect(rows[0].vm).toMatch(/^ci-/);
  } finally {
    process.env.PATH = old;
    rmSync(dir, { recursive: true });
  }
});
