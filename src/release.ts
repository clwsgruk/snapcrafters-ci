import {
  cpSync,
  mkdtempSync,
  rmSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  lstatSync,
  createReadStream,
  openSync,
  closeSync,
  constants,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, basename } from "node:path";
import { createHash } from "node:crypto";
import { stringify } from "yaml";
import { command, safeEnv } from "./execution.ts";
import { architecture, architectures, project, yaml, scalar, mapping } from "./project.ts";
import { channel, snapName, revisions } from "./validation.ts";
import { input, outputs } from "./runtime.ts";
import { api, request, ApiError, marker } from "./github.ts";
import { repository } from "./validation.ts";
import { revision } from "./manifests.ts";
export { revisions } from "./validation.ts";
export interface Published {
  snap: string;
  root: string;
  version: string;
  revision: string;
  channel: string;
  architecture: string;
  digest: string;
  sourceSha: string;
}
export interface ReleaseOptions {
  cwd: string;
  root: string;
  architecture: string;
  channel: string;
  storeToken: string;
  launchpadToken: string;
}
export const statePath = (cwd: string, arch: string) =>
  join(cwd, `.ci-release-${architecture(arch)}.json`);
async function digest(file: string) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size < 1 || stat.size > 16 * 1024 ** 3)
    throw Error("Invalid snap/component file");
  const hash = createHash("sha384");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
function readState(file: string): Published {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (lstatSync(file).size > 4096) throw Error("Release state too large");
    const value = JSON.parse(readFileSync(fd, "utf8")) as Published;
    snapName(value.snap);
    channel(value.channel);
    architecture(value.architecture);
    revision(value.revision);
    if (
      !/^[a-f0-9]{96}$/.test(value.digest) ||
      !/^[a-f0-9]{40}$/.test(value.sourceSha) ||
      typeof value.root !== "string" ||
      !/^[A-Za-z0-9.+:~_-]{1,32}$/.test(value.version)
    )
      throw Error("Invalid release state");
    return value;
  } finally {
    closeSync(fd);
  }
}
export async function publish(options: ReleaseOptions): Promise<Published> {
  const p = project(options.root, options.cwd),
    snap = snapName(p.outputs["snap-name"]),
    arch = architecture(options.architecture),
    destination = channel(options.channel);
  if (!architectures(p.data).includes(arch))
    throw Error("Architecture is not selected by the recipe");
  if (!options.storeToken || !options.launchpadToken)
    throw Error("Store and Launchpad credentials required");
  const sourceSha = command("git", ["rev-parse", "HEAD"], options.cwd).trim(),
    selectedRoot = relative(options.cwd, p.root) || ".";
  const file = statePath(options.cwd, arch),
    env = { ...safeEnv(), SNAPCRAFT_STORE_CREDENTIALS: options.storeToken };
  const readback = () =>
    revisions(command("snapcraft", ["revisions", snap, "--arch", arch], options.cwd, env));
  const verify = async (state: Published) => {
    const row = readback().find(
      (r) =>
        r.revision === state.revision &&
        r.version === state.version &&
        r.architectures.includes(arch) &&
        r.channels.includes(`${destination}*`),
    );
    if (!row) throw Error("Exact release state not active in Store");
    const dir = mkdtempSync(join(tmpdir(), "snap-download-"));
    try {
      command("snap", ["download", snap, `--revision=${state.revision}`], dir, safeEnv());
      if ((await digest(join(dir, `${snap}_${state.revision}.snap`))) !== state.digest)
        throw Error("Store snap digest differs from release state");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  try {
    const saved = readState(file);
    if (
      saved.snap !== snap ||
      saved.root !== selectedRoot ||
      saved.sourceSha !== sourceSha ||
      saved.channel !== destination ||
      saved.architecture !== arch ||
      (p.data.version != null && saved.version !== scalar(p.data.version))
    )
      throw Error("Release state does not match the selected project/source/channel");
    await verify(saved);
    return saved;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (Number(process.env.GITHUB_RUN_ATTEMPT || "1") > 1)
    throw Error("Rerun requires the exact saved release state before build/upload");
  const baseline = new Set(readback().map((r) => r.revision));
  const temporary = mkdtempSync(join(tmpdir(), "snap-release-")),
    stage = join(temporary, "project"),
    home = join(temporary, "home");
  try {
    cpSync(p.root, stage, {
      recursive: true,
      filter: (path) =>
        !lstatSync(path).isSymbolicLink() &&
        ![".git", "node_modules"].includes(basename(path)) &&
        !/\.(snap|comp|txt)$|^\.ci-release-/.test(basename(path)),
    });
    mkdirSync(join(home, ".local/share/snapcraft/provider/launchpad"), {
      recursive: true,
      mode: 0o700,
    });
    for (const suffix of ["provider/launchpad/credentials", "launchpad-credentials"])
      writeFileSync(join(home, ".local/share/snapcraft", suffix), options.launchpadToken, {
        mode: 0o600,
      });
    const stagedYaml = resolve(stage, relative(p.root, p.yaml));
    const args = ["remote-build", "--launchpad-accept-public-upload"];
    if (p.data.base !== "core24")
      writeFileSync(stagedYaml, stringify({ ...p.data, architectures: [{ "build-on": arch }] }));
    else args.push(`--build-for=${arch}`);
    command("git", ["init", "-b", `build-${arch}`], stage);
    command("git", ["add", "."], stage);
    command(
      "git",
      [
        "-c",
        "user.name=Snapcrafters",
        "-c",
        "user.email=ci@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-m",
        `Build ${sourceSha}`,
      ],
      stage,
    );
    command("snapcraft", args, stage, { ...safeEnv(), HOME: home });
    const files = readdirSync(stage).filter((f) => f.endsWith(".snap"));
    if (files.length !== 1) throw Error("Expected exactly one fresh snap");
    const snapFile = join(stage, files[0]),
      snapDigest = await digest(snapFile),
      metadata = yaml(command("unsquashfs", ["-cat", snapFile, "meta/snap.yaml"], stage));
    const version = scalar(metadata.version);
    if (
      metadata.name !== snap ||
      !Array.isArray(metadata.architectures) ||
      !metadata.architectures.includes(arch) ||
      !/^[A-Za-z0-9.+:~_-]{1,32}$/.test(version) ||
      (p.data.version != null && scalar(p.data.version) !== version)
    )
      throw Error("Fresh snap metadata mismatch");
    const components = p.data.components == null ? {} : mapping(p.data.components),
      componentArgs: string[] = [];
    for (const [name, value] of Object.entries(components)) {
      snapName(name);
      const v = mapping(value).version;
      const path = join(stage, `${snap}+${name}${v == null ? "" : `_${scalar(v)}`}.comp`);
      await digest(path);
      const meta = yaml(command("unsquashfs", ["-cat", path, "meta/component.yaml"], stage));
      if (meta.component !== `${snap}+${name}` || (v != null && scalar(meta.version) !== scalar(v)))
        throw Error("Fresh component metadata mismatch");
      componentArgs.push("--component", `${name}=${path}`);
    }
    command(
      "review-tools.snap-review",
      [
        ...(p.outputs.classic === "true" ? ["--allow-classic"] : []),
        ...(p.plugs ? ["--plugs", p.plugs] : []),
        ...(p.slots ? ["--slots", p.slots] : []),
        snapFile,
      ],
      stage,
    );
    let output = "";
    try {
      output = command(
        "snapcraft",
        ["upload", snapFile, ...componentArgs, `--release=${destination}`],
        stage,
        env,
      );
    } catch {
      /* An ambiguous upload is reconciled by exact Store readback, never retried. */
    }
    const reported = [...output.matchAll(/Revision ['"]?([1-9][0-9]*)['"]? created for/g)].map(
      (m) => m[1],
    );
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidates = readback().filter(
        (r) =>
          !baseline.has(r.revision) &&
          r.version === version &&
          r.architectures.includes(arch) &&
          r.channels.includes(`${destination}*`) &&
          (!reported.length || reported.includes(r.revision)),
      );
      if (candidates.length === 1) {
        const state: Published = {
          snap,
          root: selectedRoot,
          version,
          revision: candidates[0].revision,
          channel: destination,
          architecture: arch,
          digest: snapDigest,
          sourceSha,
        };
        await verify(state);
        writeFileSync(`${file}.tmp`, JSON.stringify(state) + "\n", { mode: 0o600, flag: "wx" });
        renameSync(`${file}.tmp`, file);
        return state;
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1000));
    }
    throw Error(
      "Upload attempted once; publication is unconfirmed. Reconcile Store state before any retry",
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export async function tagRelease(
  state: Published,
  repo: string,
  token: string,
  multi: boolean,
  name: string,
  email: string,
  base = api,
) {
  repository(repo);
  const tag = `${multi ? `${state.snap}-` : ""}${state.version}/rev${state.revision}/${state.architecture}`,
    message = `Revision ${state.revision}, released for ${state.architecture}`;
  const path = `/repos/${repo}/git`,
    refPath = `${path}/ref/tags/${encodeURIComponent(tag)}`;
  const verify = async () => {
    try {
      const ref = await request<{ object: { sha: string; type: string } }>(
        "GET",
        refPath,
        token,
        undefined,
        base,
      );
      if (ref.object.type !== "tag") throw Error("Existing tag is not annotated");
      const data = await request<{
        tag: string;
        message: string;
        object: { sha: string; type: string };
      }>("GET", `${path}/tags/${ref.object.sha}`, token, undefined, base);
      if (
        data.tag !== tag ||
        data.message.trim() !== message ||
        data.object.sha !== state.sourceSha ||
        data.object.type !== "commit"
      )
        throw Error("Existing tag differs from exact release state");
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return false;
      throw error;
    }
  };
  try {
    if (await verify()) return;
    const object = await request<{ sha: string }>(
      "POST",
      `${path}/tags`,
      token,
      {
        tag,
        message,
        object: state.sourceSha,
        type: "commit",
        tagger: { name, email, date: new Date().toISOString() },
      },
      base,
    );
    try {
      await request(
        "POST",
        `${path}/refs`,
        token,
        { ref: `refs/tags/${tag}`, sha: object.sha },
        base,
      );
    } catch (error) {
      if (!(await verify())) throw error;
    }
    if (!(await verify())) throw Error("Tag not visible after creation");
  } catch {
    throw Error(
      `Published ${state.snap} revision ${state.revision} to ${state.channel}; tag ${tag} is unconfirmed. Resume from saved state`,
    );
  }
}

export async function releaseAction() {
  const cwd = process.cwd(),
    arch = architecture(input("architecture")),
    p = project(input("snapcraft-project-root"));
  const file = statePath(cwd, arch);
  if (process.env.CI_PHASE === "prepare") {
    outputs({
      "state-name": `release-state-${snapName(p.outputs["snap-name"])}-${marker(p.outputs["project-root"]).slice(0, 12)}-${arch}`,
      "state-path": file,
    });
    return;
  }
  if (process.env.CI_PHASE === "tag") {
    await tagRelease(
      readState(file),
      process.env.GITHUB_REPOSITORY!,
      input("repo-token"),
      input("multi-snap") === "true",
      input("bot-name"),
      input("bot-email"),
    );
    return;
  }
  if (process.env.CI_PHASE === "report") {
    const s = readState(file);
    throw Error(
      `Published ${s.snap} revision ${s.revision} to ${s.channel}; artifact/tag phase failed. Exact state: ${file}`,
    );
  }
  const state = await publish({
    cwd,
    root: input("snapcraft-project-root"),
    architecture: arch,
    channel: input("channel"),
    storeToken: input("store-token"),
    launchpadToken: input("launchpad-token"),
  });
  outputs({ revision: state.revision });
  writeFileSync(
    join(cwd, `manifest-${arch}.yaml`),
    `name: ${state.snap}\narchitecture: ${arch}\nrevision: '${state.revision}'\n`,
    { mode: 0o600 },
  );
}
