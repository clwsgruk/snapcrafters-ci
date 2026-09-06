import { expect, test } from "vitest";
import { revisions } from "../src/release.ts";
test("real four/five-column Snapcraft revisions keep exact strings and channel activity", () => {
  expect(
    revisions(
      "Rev.  Uploaded  Arches  Version\n9007199254740993  2026-09-06T12:00:00Z  amd64  1.0\n",
    ),
  ).toEqual([
    { revision: "9007199254740993", architectures: ["amd64"], version: "1.0", channels: [] },
  ]);
  expect(
    revisions(
      "Rev. Uploaded Arches Version Channels\n12 2026-09-06T12:00:00Z amd64,arm64 2.0 latest/candidate*,latest/stable\n",
    )[0].channels,
  ).toEqual(["latest/candidate*"]);
  for (const text of [
    "",
    "Rev. Uploaded Arches Version\n12 today amd64 1 extra",
    "Rev. Uploaded Arches Version\n0 2026-09-06 amd64 1",
    "Rev. Uploaded Arches Version\n12 2026-09-06 nested 1",
  ])
    expect(() => revisions(text)).toThrow();
});

test("release stages fresh sources, uploads once, confirms digest, and resumes exact state before rebuild", async () => {
  const { publish } = await import("../src/release.ts");
  const { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const dir = mkdtempSync(path.join(tmpdir(), "release-")),
    work = path.join(dir, "work"),
    bin = path.join(dir, "bin"),
    log = path.join(dir, "calls"),
    store = path.join(dir, "published");
  mkdirSync(work);
  mkdirSync(bin);
  writeFileSync(
    path.join(work, "snapcraft.yaml"),
    "name: sample\nbase: core22\nadopt-info: app\narchitectures: [amd64]\n",
  );
  writeFileSync(path.join(work, "stale.snap"), "stale");
  writeFileSync(path.join(work, "requirements.txt"), "needed source");
  execFileSync("git", ["init", work], { stdio: "ignore" });
  execFileSync("git", ["add", "snapcraft.yaml"], { cwd: work });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.org",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "initial",
    ],
    { cwd: work, stdio: "ignore" },
  );
  const fake = `#!${process.execPath}\nconst fs=require('node:fs'),p=require('node:path'),a=process.argv.slice(2),tool=p.basename(process.argv[1]);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify([tool,...a])+'\\n'); const store=${JSON.stringify(store)};
if(tool==='snapcraft'&&a[0]==='revisions'&&a[1]==='sample'&&a[2]==='--arch'&&a[3]==='amd64'&&a.length===4){console.log('Rev. Uploaded Arches Version Channels');if(fs.existsSync(store)) console.log('12 2026-09-06T12:00:00Z amd64 2.0 latest/candidate*');}
else if(tool==='snapcraft'&&JSON.stringify(a)===JSON.stringify(['remote-build','--launchpad-accept-public-upload'])){if(fs.existsSync('stale.snap')||!fs.existsSync('requirements.txt'))process.exit(91);if(!fs.readFileSync('snapcraft.yaml','utf8').includes('build-on'))process.exit(92);fs.writeFileSync('sample_2.0_amd64.snap','fresh');}
else if(tool==='snapcraft'&&a[0]==='upload'&&a.length===3&&a[2]==='--release=latest/candidate'){fs.writeFileSync(store,'fresh');console.log("Revision 12 created for 'sample'");}
else if(tool==='unsquashfs'&&a[0]==='-cat'&&a[2]==='meta/snap.yaml'&&a.length===3){console.log('name: sample\\nversion: "2.0"\\narchitectures: [amd64]');}
else if(tool==='snap'&&JSON.stringify(a)===JSON.stringify(['download','sample','--revision=12'])){fs.writeFileSync('sample_12.snap',fs.readFileSync(store));}
else if(tool==='review-tools.snap-review'&&a.length===1&&a[0].endsWith('.snap')){}
else {console.error('unsupported',tool,a);process.exit(90);}`;
  for (const tool of ["snapcraft", "snap", "unsquashfs", "review-tools.snap-review"])
    writeFileSync(path.join(bin, tool), fake, { mode: 0o700 });
  const old = process.env.PATH;
  process.env.PATH = `${bin}:${old}`;
  try {
    const options = {
      cwd: work,
      root: "",
      architecture: "amd64",
      channel: "latest/candidate",
      storeToken: "store-token",
      launchpadToken: "lp-token",
    };
    const state = await publish(options);
    expect(state).toMatchObject({ snap: "sample", revision: "12", version: "2.0" });
    expect(existsSync(path.join(work, "stale.snap"))).toBe(true);
    expect(await publish(options)).toEqual(state);
    const calls = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(calls.filter((a) => a[1] === "upload")).toHaveLength(1);
    expect(calls.filter((a) => a[1] === "remote-build")).toHaveLength(1);
    await expect(publish({ ...options, channel: "latest/beta" })).rejects.toThrow(/state/);
  } finally {
    process.env.PATH = old;
    rmSync(dir, { recursive: true });
  }
});

test("tag creation recovers a lost ref response and verifies the exact annotated target", async () => {
  const { tagRelease } = await import("../src/release.ts");
  const { createServer } = await import("node:http");
  let ref = false,
    writes = 0;
  const state = {
    snap: "sample",
    root: ".",
    version: "2.0",
    revision: "12",
    channel: "latest/candidate",
    architecture: "amd64",
    digest: "a".repeat(96),
    sourceSha: "b".repeat(40),
  };
  const tag = "sample-2.0/rev12/amd64",
    tagObject = {
      tag,
      message: "Revision 12, released for amd64",
      object: { sha: state.sourceSha, type: "commit" },
    };
  const server = createServer(async (req, res) => {
    expect(req.headers.authorization).toBe("Bearer repo-token");
    if (req.method === "GET" && req.url?.includes("/git/ref/tags/")) {
      if (!ref) {
        res.writeHead(404);
        res.end("{}");
      } else res.end(JSON.stringify({ object: { sha: "c".repeat(40), type: "tag" } }));
    } else if (req.method === "GET" && req.url?.includes("/git/tags/"))
      res.end(JSON.stringify(tagObject));
    else if (req.method === "POST" && req.url?.endsWith("/git/tags")) {
      writes++;
      res.end(JSON.stringify({ sha: "c".repeat(40) }));
    } else if (req.method === "POST" && req.url?.endsWith("/git/refs")) {
      writes++;
      ref = true;
      req.socket.destroy();
    } else {
      res.writeHead(403);
      res.end("{}");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await tagRelease(state, "owner/repo", "repo-token", true, "Bot", "bot@example.org", base);
    await tagRelease(state, "owner/repo", "repo-token", true, "Bot", "bot@example.org", base);
    expect(writes).toBe(2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
