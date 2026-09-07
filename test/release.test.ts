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

test.each([
  "success",
  "build-failure",
  "upload-disconnect",
  "wrong-digest",
  "stale-baseline",
  "auth-after-upload",
  "extra-component",
  "component-success",
  "component-mismatch",
  "core18",
  "core20",
  "core24",
  "symlink-source",
])("release publication boundary: %s", async (mode) => {
  const { publish } = await import("../src/release.ts");
  const { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync, symlinkSync } =
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
    `name: sample\nbase: ${mode.startsWith("core") ? mode : "core22"}\nadopt-info: app\n${mode === "core24" ? "platforms: {amd64: null}" : "architectures: [amd64]"}\n${mode.startsWith("component-") ? "components: {extra: {type: standard, version: 1}}\n" : ""}`,
  );
  writeFileSync(path.join(work, "stale.snap"), "stale");
  writeFileSync(path.join(work, "requirements.txt"), "needed source");
  if (mode === "symlink-source") {
    mkdirSync(path.join(work, "assets"));
    mkdirSync(path.join(work, "snap/gui"), { recursive: true });
    writeFileSync(path.join(work, "assets/icon.png"), "icon");
    symlinkSync("../../assets/icon.png", path.join(work, "snap/gui/icon.png"));
  }
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
  const fake = `#!${process.execPath}\nconst fs=require('node:fs'),p=require('node:path'),a=process.argv.slice(2),tool=p.basename(process.argv[1]);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify([tool,...a])+'\\n'); const store=${JSON.stringify(store)},mode=${JSON.stringify(mode)};
if(tool==='snapcraft'&&a[0]==='revisions'&&a[1]==='sample'&&a[2]==='--arch'&&a[3]==='amd64'&&a.length===4){if(mode==='auth-after-upload'&&fs.existsSync(store))process.exit(93);console.log('Rev. Uploaded Arches Version Channels');if(fs.existsSync(store)) console.log('12 2026-09-06T12:00:00Z amd64 2.0 latest/candidate*');}
else if(tool==='snapcraft'&&JSON.stringify(a)===JSON.stringify(['remote-build','--launchpad-accept-public-upload',...(mode==='core24'?['--build-for=amd64']:[])])){if(fs.existsSync('stale.snap')||!fs.existsSync('requirements.txt'))process.exit(91);if(mode!=='core24'&&!fs.readFileSync('snapcraft.yaml','utf8').includes('build-on'))process.exit(92);if(mode==='symlink-source'&&(!fs.existsSync('snap/gui/icon.png')||!fs.lstatSync('snap/gui/icon.png').isFile()))process.exit(94);fs.writeFileSync('sample_2.0_amd64.snap','fresh');if(mode.startsWith('component-'))fs.writeFileSync('sample+extra_1.comp','component');if(mode==='extra-component')fs.writeFileSync('unrelated.comp','component');if(mode==='build-failure')process.exit(2);}
else if(tool==='snapcraft'&&a[0]==='upload'&&a.length===(mode.startsWith('component-')?5:3)&&a[1].endsWith('/sample_2.0_amd64.snap')&&fs.existsSync(a[1])&&a.at(-1)==='--release=latest/candidate'&&(!mode.startsWith('component-')||(a[2]==='--component'&&a[3].startsWith('extra=')&&a[3].endsWith('/sample+extra_1.comp')&&fs.existsSync(a[3].slice(a[3].indexOf('=')+1))))){fs.writeFileSync(store,mode==='wrong-digest'?'unrelated':'fresh');if(mode==='upload-disconnect')process.exit(2);console.log("Revision 12 created for 'sample'");}
else if(tool==='unsquashfs'&&a[0]==='-cat'&&a[2]==='meta/snap.yaml'&&a.length===3){console.log('name: sample\\nversion: "2.0"\\narchitectures: [amd64]');}
else if(tool==='unsquashfs'&&a[0]==='-cat'&&a[2]==='meta/component.yaml'&&a.length===3)console.log('component: '+(mode==='component-mismatch'?'other':'sample')+'+extra\\nversion: 1');
else if(tool==='snap'&&JSON.stringify(a)===JSON.stringify(['download','sample','--revision=12'])){if(fs.readFileSync(store,'utf8')!=='missing-download')fs.writeFileSync('sample_12.snap',fs.readFileSync(store));}
else if(tool==='review-tools.snap-review'&&a.length===1&&a[0].endsWith('.snap')){}
else {console.error('unsupported',tool,a);process.exit(90);}`;
  for (const tool of ["snapcraft", "snap", "unsquashfs", "review-tools.snap-review"])
    writeFileSync(path.join(bin, tool), fake, { mode: 0o700 });
  execFileSync(process.execPath, ["--check", path.join(bin, "snapcraft")]);
  const old = process.env.PATH,
    oldAttempt = process.env.GITHUB_RUN_ATTEMPT;
  symlinkSync("/usr/bin/git", path.join(bin, "git"));
  process.env.PATH = bin;
  process.env.GITHUB_RUN_ATTEMPT = "1";
  try {
    const options = {
      cwd: work,
      root: "",
      architecture: "amd64",
      channel: "latest/candidate",
      storeToken: "store-token",
      launchpadToken: "lp-token",
    };
    if (mode === "stale-baseline") writeFileSync(store, "fresh");
    if (
      [
        "build-failure",
        "extra-component",
        "component-mismatch",
        "wrong-digest",
        "stale-baseline",
        "auth-after-upload",
      ].includes(mode)
    ) {
      await expect(publish(options)).rejects.toThrow(
        mode === "build-failure"
          ? /remote-build/
          : ["extra-component", "component-mismatch"].includes(mode)
            ? /component/
            : /Upload attempted once/,
      );
      const calls = readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      expect(calls.filter((a) => a[1] === "upload")).toHaveLength(
        ["build-failure", "extra-component", "component-mismatch"].includes(mode) ? 0 : 1,
      );
      expect(existsSync(path.join(work, ".ci-release-amd64.json"))).toBe(false);
      return;
    }
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
    writeFileSync(store, "missing-download");
    await expect(publish(options)).rejects.toThrow(/ENOENT/);
    expect(
      readFileSync(log, "utf8")
        .split("\n")
        .filter((l) => l.includes('"upload"')),
    ).toHaveLength(1);
  } finally {
    process.env.PATH = old;
    if (oldAttempt === undefined) delete process.env.GITHUB_RUN_ATTEMPT;
    else process.env.GITHUB_RUN_ATTEMPT = oldAttempt;
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

test("published manifest artifact must read back exactly before tagging, including a replay", async () => {
  const { verifyManifest } = await import("../src/release.ts");
  const { zip } = await import("./zip.ts");
  const { createServer } = await import("node:http");
  let value = "12",
    present = true;
  const state = { snap: "sample", architecture: "amd64", revision: "12" };
  const server = createServer((req, res) => {
    expect(req.headers.authorization).toBe("Bearer repo-token");
    if (req.method !== "GET") {
      res.writeHead(403);
      res.end();
      return;
    }
    if (req.url === "/repos/owner/repo/actions/runs/1/artifacts?per_page=100&page=1")
      res.end(
        JSON.stringify({
          artifacts: present ? [{ id: 1, name: "manifest-amd64", expired: false }] : [],
        }),
      );
    else if (req.url === "/repos/owner/repo/actions/artifacts/1/zip")
      res.end(
        zip([["manifest-amd64.yaml", `name: sample\narchitecture: amd64\nrevision: '${value}'\n`]]),
      );
    else {
      res.writeHead(403);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await verifyManifest(state, "owner/repo", "1", "repo-token", base);
    await verifyManifest(state, "owner/repo", "1", "repo-token", base);
    value = "99";
    await expect(verifyManifest(state, "owner/repo", "1", "repo-token", base)).rejects.toThrow(
      /manifest.*publication/,
    );
    present = false;
    await expect(verifyManifest(state, "owner/repo", "1", "repo-token", base)).rejects.toThrow(
      /manifest.*publication/,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
