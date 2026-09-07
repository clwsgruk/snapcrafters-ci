import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import {
  constants,
  openSync,
  closeSync,
  lstatSync,
  fstatSync,
  readSync,
  readlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

import { command, safeEnv, readBounded } from "./execution.ts";
import { api, request, ApiError, marker, marked, pages } from "./github.ts";
import { revision, fetchManifests } from "./manifests.ts";
import { project } from "./project.ts";
import { input, outputs } from "./runtime.ts";
import { repository, snapName, channel } from "./validation.ts";

export function validPng(bytes: Buffer) {
  if (
    bytes.length < 33 ||
    bytes.length > 8 * 1024 * 1024 ||
    !bytes.subarray(0, 16).equals(Buffer.from("89504e470d0a1a0a0000000d49484452", "hex")) ||
    !bytes.readUInt32BE(16) ||
    !bytes.readUInt32BE(20) ||
    bytes.readUInt32BE(16) > 16384 ||
    bytes.readUInt32BE(20) > 16384
  ) {
    throw Error("Invalid PNG size/signature");
  }

  return bytes;
}

export function png(directory: string, kind: "screen" | "window") {
  const dir = lstatSync(directory);
  if (!dir.isDirectory() || dir.uid !== process.getuid!()) {
    throw Error("Screenshot directory is not owned");
  }

  let file = join(directory, `screenshot-${kind}.png`);
  if (lstatSync(file).isSymbolicLink()) {
    const alias = readlinkSync(file);
    if (
      basename(alias) !== alias ||
      !new RegExp(`^screenshot-${kind}-[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}\\.png$`).test(alias)
    ) {
      throw Error("Unsafe screenshot alias");
    }
    file = join(directory, alias);
  }

  const before = lstatSync(file);
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid!() ||
      stat.ino !== before.ino ||
      stat.dev !== before.dev ||
      stat.size > 8 * 1024 * 1024
    ) {
      throw Error("Unsafe screenshot file");
    }

    const buffer = Buffer.alloc(stat.size + 1);
    let size = 0;
    let read = 0;
    while ((read = readSync(fd, buffer, size, buffer.length - size, null))) {
      size += read;
    }
    if (size !== stat.size || fstatSync(fd).size !== stat.size) {
      throw Error("Screenshot changed while reading");
    }

    return validPng(buffer.subarray(0, size));
  } finally {
    closeSync(fd);
  }
}

export interface Screenshots {
  repo: string;
  token: string;
  snap: string;
  issue: string;
  date: string;
  screen: Buffer;
  window: Buffer;
  name: string;
  email: string;
  key?: string;
}

export async function uploadScreenshots(value: Screenshots, base = api) {
  repository(value.repo);
  snapName(value.snap);
  revision(value.issue);
  validPng(value.screen);
  validPng(value.window);
  if (
    !/^\d{4}-\d\d-\d\d$/.test(value.date) ||
    new Date(value.date).toISOString().slice(0, 10) !== value.date
  ) {
    throw Error("Invalid screenshot date");
  }

  const deadline = Date.now() + 60000;
  const prefix = `/repos/${value.repo}`;
  const paths = ["screen", "window"].map(
    (kind) => `${value.date.replaceAll("-", "")}-${value.snap}-${value.issue}-${kind}.png`,
  );

  const call = <T>(method: string, path: string, body?: unknown) =>
    request<T>(method, `${prefix}${path}`, value.token, body, base, deadline);

  const repo = await call<{ default_branch: string }>("GET", "");
  const ref = `/git/ref/heads/${encodeURIComponent(repo.default_branch)}`;
  const head = async () => {
    const reference = await call<{ object: { sha: string } }>("GET", ref);
    return reference.object.sha;
  };

  const blobs: string[] = [];
  for (const bytes of [value.screen, value.window]) {
    const blob = await call<{ sha: string }>("POST", "/git/blobs", {
      encoding: "base64",
      content: bytes.toString("base64"),
    });
    blobs.push(blob.sha);
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const parent = await head();
    const commit = await call<{ tree: { sha: string } }>("GET", `/git/commits/${parent}`);
    const tree = await call<{ sha: string }>("POST", "/git/trees", {
      base_tree: commit.tree.sha,
      tree: paths.map((path, i) => ({ path, mode: "100644", type: "blob", sha: blobs[i] })),
    });
    const next = await call<{ sha: string }>("POST", "/git/commits", {
      message: `data: screenshots for ${value.snap}#${value.issue}${value.key ? `\nci-screenshots:${value.key}:${value.date}` : ""}`,
      tree: tree.sha,
      parents: [parent],
      author: { name: value.name, email: value.email },
    });

    let failure: unknown;
    try {
      await call("PATCH", `/git/refs/heads/${encodeURIComponent(repo.default_branch)}`, {
        sha: next.sha,
        force: false,
      });
    } catch (error) {
      failure = error;
    }

    const actual = await head();
    if (actual === next.sha) {
      return {
        screen: `https://raw.githubusercontent.com/${value.repo}/${next.sha}/${paths[0]}`,
        window: `https://raw.githubusercontent.com/${value.repo}/${next.sha}/${paths[1]}`,
      };
    }
    if (
      !(failure instanceof ApiError) ||
      ![409, 422].includes(failure.status) ||
      !failure.conflict ||
      actual === parent
    ) {
      throw Error("Screenshot ref update unconfirmed; no retry without a confirmed conflict");
    }
  }

  throw Error("Screenshot conflict retry limit exceeded");
}

export async function capture(snap: string, app: string, target: string, rev?: string) {
  snapName(snap);
  snapName(app);
  channel(target);
  if (rev) {
    revision(rev);
  }

  const home = mkdtempSync(join(tmpdir(), "ci-vm-"));
  const env = { ...safeEnv(), HOME: home, SNAP_REAL_HOME: home, VM_NAME: `ci-${randomUUID()}` };
  try {
    command("ghvmctl", ["prepare"], home, env);
    command(
      "ghvmctl",
      ["snap-install", snap, ...(rev ? ["--revision", rev] : ["--channel", target])],
      home,
      env,
    );
    command("ghvmctl", ["snap-run", `${snap}.${app}`], home, env);

    let ready = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        command(
          "ghvmctl",
          [
            "exec",
            "gnome-screenshot -w -f /home/ubuntu/.ghvmctl-window-ready.png && test -s /home/ubuntu/.ghvmctl-window-ready.png",
          ],
          home,
          env,
          2000,
        );
        ready = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    if (!ready) {
      throw Error("Window readiness deadline exceeded");
    }
    command("ghvmctl", ["screenshot-full"], home, env);
    command("ghvmctl", ["screenshot-window"], home, env);
    return {
      screen: png(join(home, "ghvmctl-screenshots"), "screen"),
      window: png(join(home, "ghvmctl-screenshots"), "window"),
    };
  } finally {
    try {
      command("lxc", ["delete", "--force", env.VM_NAME], home, env);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }
}

export async function screenshotAction() {
  if (input("ci-repo") !== "snapcrafters/ci") {
    throw Error("ci-repo overrides are deprecated; pin a forked action SHA");
  }

  const p = project(input("snapcraft-project-root"));
  const snap = snapName(p.outputs["snap-name"]);
  const issue = revision(input("issue-number"));
  const repo = repository(process.env.GITHUB_REPOSITORY!);
  const images = repository(input("screenshots-repo"));
  const token = input("github-token");

  const key = marker([repo, snap, p.root, issue, process.env.GITHUB_RUN_ID]);
  const file = join(process.cwd(), `.ci-screenshots-${key}.json`);

  let urls: { screen: string; window: string };
  try {
    urls = JSON.parse(readBounded(file, 4096).toString("utf8"));
    if (!urls || Object.keys(urls).sort().join(",") !== "screen,window") {
      throw Error("Invalid screenshot state fields");
    }
    for (const url of Object.values(urls)) {
      if (
        !url.startsWith(`https://raw.githubusercontent.com/${images}/`) ||
        !/\/[a-f0-9]{40}\//.test(url)
      ) {
        throw Error("Screenshot state mismatch");
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    if (Number(process.env.GITHUB_RUN_ATTEMPT || "1") > 1) {
      urls = await recoverScreenshots(images, snap, issue, key, input("screenshots-token"));
    } else {
      const rows = await fetchManifests(token, repo, process.env.GITHUB_RUN_ID!, process.cwd(), {
        snap,
      });
      const selected = rows.find((r) => r.architecture === "amd64");
      if (rows.length && !selected) {
        throw Error("Missing amd64 screenshot manifest");
      }

      const captures = await capture(
        snap,
        input("snap-application-name") || snap,
        channel(input("channel")),
        selected?.revision,
      );
      urls = await uploadScreenshots({
        repo: images,
        key,
        token: input("screenshots-token"),
        snap,
        issue,
        date: new Date().toISOString().slice(0, 10),
        ...captures,
        name: input("bot-name"),
        email: input("bot-email"),
      });
    }
    writeFileSync(file, JSON.stringify(urls), { mode: 0o600, flag: "wx" });
  }

  outputs(urls);
  try {
    await marked(
      `/repos/${repo}/issues/${issue}/comments`,
      { body: `![Full screen](${urls.screen})\n\n![Application window](${urls.window})` },
      key,
      token,
    );
  } catch {
    throw Error(
      `Screenshots committed at ${urls.screen}; comment failed. Retry uses exact state ${file}`,
    );
  }
}

export async function recoverScreenshots(
  repo: string,
  snap: string,
  issue: string,
  key: string,
  token: string,
  base = api,
) {
  repository(repo);
  snapName(snap);
  revision(issue);

  const commits = await pages<{ sha: string; commit: { message: string } }>(
    `/repos/${repo}/commits`,
    token,
    undefined,
    base,
  );

  const prefix = `data: screenshots for ${snap}#${issue}\nci-screenshots:${key}:`;
  const matches = commits.filter((c) => c.commit.message.startsWith(prefix));
  if (matches.length !== 1 || !/^[a-f0-9]{40}$/.test(matches[0].sha)) {
    throw Error("Exact screenshot state could not be recovered; no upload attempted");
  }

  const date = matches[0].commit.message.slice(prefix.length);
  if (!/^\d{4}-\d\d-\d\d$/.test(date) || new Date(date).toISOString().slice(0, 10) !== date) {
    throw Error("Invalid screenshot state date");
  }

  const url = `https://raw.githubusercontent.com/${repo}/${matches[0].sha}/${date.replaceAll("-", "")}-${snap}-${issue}`;
  return { screen: `${url}-screen.png`, window: `${url}-window.png` };
}
