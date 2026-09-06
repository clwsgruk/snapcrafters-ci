import {
  mkdtempSync,
  mkdirSync,
  cpSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { action, expectedUses, pins } from "./wrappers.ts";
import { testingBody } from "../src/testing.ts";
const exec = promisify(execFile);
export async function smoke(name: string, patch: NodeJS.ProcessEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), "wrapper-")),
    work = join(dir, "consumer"),
    copy = join(dir, "action"),
    bin = join(dir, "bin"),
    log = join(dir, "commands"),
    flag = join(dir, "store"),
    out = join(dir, "output");
  for (const p of [work, copy, bin]) mkdirSync(p);
  cpSync(`${name}/dist`, join(copy, "dist"), { recursive: true });
  cpSync(`${name}/action.yaml`, join(copy, "action.yaml"));
  if (existsSync(join(copy, "node_modules"))) throw Error("copied bundle must be standalone");
  writeFileSync(
    join(work, "snapcraft.yaml"),
    "name: sample\nversion: '1'\nbase: core22\narchitectures: [amd64]\n",
  );
  execFileSync("git", ["init", "-b", "candidate", work], { stdio: "ignore" });
  execFileSync("git", ["add", "snapcraft.yaml"], { cwd: work });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Tester",
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
  const remote = join(dir, "remote.git");
  execFileSync("git", ["init", "--bare", remote], { stdio: "ignore" });
  execFileSync("git", ["remote", "add", "origin", remote], { cwd: work });
  execFileSync("git", ["push", "-u", "origin", "candidate"], { cwd: work, stdio: "ignore" });
  const a = action(name),
    inputs = Object.fromEntries(
      Object.entries(a.inputs || {}).map(([k, v]) => [k, String(v.default ?? "")]),
    );
  Object.assign(inputs, {
    token: "artifact-token",
    "github-token": "issue-token",
    "repo-token": "repo-token",
    "screenshots-token": "screenshot-token",
    "store-token": "store-token",
    "launchpad-token": "lp-token",
    "issue-number": "1",
    architectures: "amd64",
    snap: join(work, "built.snap"),
    "test-script": 'printf "first\\n"; printf "second\\n" >&2',
    "update-script": `printf "name: sample\\nversion: '2'\\nbase: core22\\narchitectures: [amd64]\\n" > snapcraft.yaml`,
  });
  writeFileSync(join(work, "built.snap"), "snap");
  if (name === "sync-version") rmSync(join(work, "built.snap"));
  const comment = {
    id: 7,
    body: "/promote 12 latest/stable done",
    created_at: "2026-09-06T00:00:00Z",
    updated_at: "2026-09-06T00:00:00Z",
    user: { login: "maintainer" },
  };
  const issue = {
    number: 1,
    state: "open",
    labels: [{ name: "testing" }],
    body: testingBody(
      {
        repository: "owner/repo",
        snap: "sample",
        channel: "latest/candidate",
        destination: "latest/stable",
        version: "1",
        rows: [{ name: "sample", architecture: "amd64", revision: "12" }],
      },
      "Try it",
    ),
  };
  writeFileSync(
    join(dir, "event.json"),
    JSON.stringify({
      action: "created",
      repository: { full_name: "owner/repo" },
      sender: { login: "maintainer" },
      issue: { number: 1 },
      comment,
    }),
  );
  const messages: unknown[] = [],
    reactions: unknown[] = [];
  let head = "a".repeat(40),
    tagged = false,
    tagData: unknown;
  const requests: string[] = [];
  const server = createServer(async (req, res) => {
    const path = req.url!,
      method = req.method!;
    requests.push(`${method} ${path}`);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    const images = path.startsWith("/repos/snapcrafters/ci-screenshots");
    const tag =
      path.includes("/git/tags") || path.includes("/git/refs") || path.includes("/git/ref/tags");
    const expected = images
      ? "screenshot-token"
      : tag
        ? "repo-token"
        : name === "fetch-manifests"
          ? "artifact-token"
          : "issue-token";
    if (req.headers.authorization !== `Bearer ${expected}`) {
      res.writeHead(403);
      res.end("{}");
      return;
    }
    let result: unknown;
    if (method === "GET" && path.includes("/actions/runs/1/artifacts?")) result = { artifacts: [] };
    else if (method === "GET" && path === "/user") result = { id: 3 };
    else if (path === "/repos/owner/repo/collaborators/maintainer/permission" && method === "GET")
      result = { permission: "write" };
    else if (path === "/repos/owner/repo/issues/comments/7" && method === "GET") result = comment;
    else if (path === "/repos/owner/repo/issues/1" && ["GET", "PATCH"].includes(method)) {
      if (method === "PATCH") issue.state = "closed";
      result = issue;
    } else if (path.startsWith("/repos/owner/repo/issues/comments/7/reactions")) {
      if (method === "POST") {
        reactions.push({ content: "+1", user: { id: 3 } });
        result = {};
      } else result = reactions;
    } else if (
      path.startsWith("/repos/owner/repo/issues/1/comments") ||
      /^\/repos\/owner\/repo\/issues(?:\?|$)/.test(path)
    ) {
      if (method === "POST") {
        result = { id: 8, number: 1, ...body };
        messages.push(result);
      } else result = messages;
    } else if (images && method === "GET" && path === "/repos/snapcrafters/ci-screenshots")
      result = { default_branch: "main" };
    else if (images && method === "GET" && path.endsWith("/git/ref/heads/main"))
      result = { object: { sha: head } };
    else if (images && method === "GET" && path.includes("/git/commits/"))
      result = { tree: { sha: "b".repeat(40) } };
    else if (images && method === "POST" && path.endsWith("/git/blobs"))
      result = { sha: "c".repeat(40) };
    else if (images && method === "POST" && path.endsWith("/git/trees"))
      result = { sha: "d".repeat(40) };
    else if (images && method === "POST" && path.endsWith("/git/commits"))
      result = { sha: "e".repeat(40) };
    else if (images && method === "PATCH" && path.endsWith("/git/refs/heads/main")) {
      head = body.sha;
      result = {};
    } else if (tag && method === "GET" && path.includes("/git/ref/tags/")) {
      if (!tagged) {
        res.writeHead(404);
        res.end("{}");
        return;
      }
      result = { object: { sha: "f".repeat(40), type: "tag" } };
    } else if (tag && method === "POST" && path.endsWith("/git/tags")) {
      tagData = {
        tag: body.tag,
        message: body.message,
        object: { sha: body.object, type: "commit" },
      };
      result = { sha: "f".repeat(40) };
    } else if (tag && method === "POST" && path.endsWith("/git/refs")) {
      tagged = true;
      result = {};
    } else if (tag && method === "GET" && path.includes("/git/tags/")) result = tagData;
    else {
      res.writeHead(403);
      res.end("{}");
      return;
    }
    res.end(JSON.stringify(result));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const hook = join(dir, "network.mjs");
  writeFileSync(
    hook,
    `const real=globalThis.fetch;globalThis.fetch=(url,options)=>{const u=new URL(url);if(u.origin!=='https://api.github.com')throw Error('unexpected network '+u.origin);return real(${JSON.stringify(base)}+u.pathname+u.search,options);};`,
  );
  const fake = `#!${process.execPath}\nconst fs=require('node:fs'),p=require('node:path'),a=process.argv.slice(2),tool=p.basename(process.argv[1]),flag=${JSON.stringify(flag)},scenario=${JSON.stringify(name)};fs.appendFileSync(${JSON.stringify(log)},JSON.stringify([tool,...a])+'\\n');const is=(b)=>JSON.stringify(a)===JSON.stringify(b),bad=()=>process.exit(90);
if(tool==='sudo'){if(is(['tee','/etc/udev/rules.d/99-kvm4all.rules'])){fs.readFileSync(0);}else if(is(['udevadm','control','--reload-rules'])||is(['udevadm','trigger','--name-match=kvm'])){}else if(a[0]==='snap'&&a[1]==='install'&&(['snapcraft','review-tools','ghvmctl','sample'].includes(a[2])||a[2]==='--classic')){const allowed=[['snap','install','snapcraft','--channel','latest/stable','--classic'],['snap','install','review-tools'],['snap','install','ghvmctl','--revision=16'],['snap','install','sample','--channel','latest/candidate']];if(!allowed.some(is)&&!(a.length===5&&a[2]==='--classic'&&a[3]==='--dangerous'&&a[4].endsWith('built.snap')))bad();}else if(is(['snap','connect','ghvmctl:lxd','lxd:lxd'])){}else bad();}
else if(tool==='snap'){if(is(['list','review-tools']))process.exit(1);else if(is(['list','ghvmctl']))console.log('ghvmctl 0.4.1 16 latest/stable - classic');else if(is(['download','sample','--revision=12']))fs.writeFileSync('sample_12.snap','fresh');else bad();}
else if(tool==='dpkg'&&is(['--print-architecture']))console.log('amd64');
else if(tool==='review-tools.snap-review'&&a.length===1&&a[0].endsWith('.snap')){}
else if(tool==='snapcraft'){if(is(['revisions','sample','--arch','amd64'])){console.log('Rev. Uploaded Arches Version Channels');if(scenario!=='release-to-candidate'||fs.existsSync(flag))console.log('12 2026-09-06T00:00:00Z amd64 1 '+(fs.existsSync(flag)&&scenario==='promote-to-stable'?'latest/stable*':'latest/candidate*'));}else if(is(['remote-build','--launchpad-accept-public-upload']))fs.writeFileSync('sample_1_amd64.snap','fresh');else if(a.length===3&&a[0]==='upload'&&a[1].endsWith('sample_1_amd64.snap')&&a[2]==='--release=latest/candidate'){fs.writeFileSync(flag,'yes');console.log("Revision 12 created for 'sample'");}else if(is(['release','sample','12','latest/stable']))fs.writeFileSync(flag,'yes');else bad();}
else if(tool==='unsquashfs'&&a.length===3&&a[0]==='-cat'&&a[2]==='meta/snap.yaml')console.log("name: sample\\nversion: '1'\\narchitectures: [amd64]");
else if(tool==='ghvmctl'){if(is(['prepare'])||is(['snap-install','sample','--channel','latest/candidate'])||is(['snap-run','sample.sample'])){}else if(a[0]==='exec'&&a.length===2&&a[1]==='gnome-screenshot -w -f /home/ubuntu/.ghvmctl-window-ready.png && test -s /home/ubuntu/.ghvmctl-window-ready.png'){}else if(is(['screenshot-full'])||is(['screenshot-window'])){const kind=a[0]==='screenshot-full'?'screen':'window',d=p.join(process.env.SNAP_REAL_HOME,'ghvmctl-screenshots');fs.mkdirSync(d,{recursive:true});const b=Buffer.alloc(33);Buffer.from('89504e470d0a1a0a0000000d49484452','hex').copy(b);b.writeUInt32BE(1,16);b.writeUInt32BE(1,20);const file='screenshot-'+kind+'-2026-09-06_120000.png';fs.writeFileSync(p.join(d,file),b);fs.symlinkSync(file,p.join(d,'screenshot-'+kind+'.png'));}else bad();}
else if(tool==='lxc'&&a.length===3&&a[0]==='delete'&&a[1]==='--force'&&a[2]===process.env.VM_NAME){}else bad();`;
  for (const tool of [
    "sudo",
    "snap",
    "dpkg",
    "review-tools.snap-review",
    "snapcraft",
    "unsquashfs",
    "ghvmctl",
    "lxc",
  ]) {
    writeFileSync(join(bin, tool + ".cjs"), fake, { mode: 0o700 });
    symlinkSync(tool + ".cjs", join(bin, tool));
  }
  for (const [tool, path] of [
    ["node", process.execPath],
    ["git", "/usr/bin/git"],
    ["bash", "/bin/bash"],
  ])
    symlinkSync(path, join(bin, tool));
  const env: NodeJS.ProcessEnv = {
    PATH: bin,
    HOME: dir,
    GITHUB_ACTION_PATH: copy,
    GITHUB_WORKSPACE: work,
    GITHUB_OUTPUT: out,
    GITHUB_STEP_SUMMARY: join(dir, "summary"),
    GITHUB_EVENT_PATH: join(dir, "event.json"),
    GITHUB_REPOSITORY: "owner/repo",
    GITHUB_RUN_ID: "1",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_SERVER_URL: "https://github.com",
    RUNNER_ENVIRONMENT: "github-hosted",
    RUNNER_OS: "Linux",
    ImageOS: "ubuntu24",
    NODE_OPTIONS: `--import=${hook}`,
    CI_PHASE: "hostile",
    ...patch,
  };
  const steps: Record<string, Record<string, string>> = {},
    uses: string[] = [];
  let nodes = 0,
    code = 0;
  const render = (text: unknown) =>
    String(text).replace(
      /\$\{\{\s*(inputs\.([\w-]+)|steps\.([\w-]+)\.outputs\.([\w-]+)|github\.(run_id|run_attempt))\s*}}/g,
      (_, _all: string, key: string, step: string, output: string, github: string) =>
        key ? inputs[key] : step ? (steps[step]?.[output] ?? "") : github === "run_id" ? "1" : "1",
    );
  try {
    for (const s of a.runs.steps) {
      if (s.if) {
        if (s.if === "github.run_attempt != '1'" || s.if.startsWith("failure()")) continue;
        if (s.if === "inputs.install == 'true'" && inputs.install !== "true") continue;
      }
      if (s.uses) {
        const [tool, sha] = s.uses.split("@");
        if (sha !== pins[tool as keyof typeof pins] || !expectedUses[name].includes(tool))
          throw Error(`Unknown external action ${s.uses}`);
        uses.push(tool);
        if (
          tool === "actions/setup-node" &&
          (!process.version.startsWith("v24.") || s.with?.["node-version"] !== "24")
        )
          throw Error(
            `Node 24 required: ${process.version}, ${process.execPath}, ${s.with?.["node-version"]}`,
          );
        if (tool === "snapcore/action-build") steps[s.id!] = { snap: join(work, "built.snap") };
        if (tool === "actions/upload-artifact" && !existsSync(join(work, render(s.with!.path)))) {
          if (!existsSync(render(s.with!.path))) throw Error("Missing artifact");
        }
        continue;
      }
      if (s.run?.includes("dist/index.cjs")) nodes++;
      writeFileSync(out, "");
      try {
        await exec("/bin/bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", s.run!], {
          cwd: work,
          env: {
            ...env,
            ...Object.fromEntries(Object.entries(s.env || {}).map(([k, v]) => [k, render(v)])),
          },
          timeout: 15000,
        });
      } catch (error) {
        code =
          typeof (error as { code?: unknown }).code === "number"
            ? (error as { code: number }).code
            : 1;
        if (!patch.RUNNER_ENVIRONMENT) throw error;
        break;
      }
      const values: Record<string, string> = {};
      const lines = readFileSync(out, "utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("<<")) {
          const [key, delimiter] = lines[i].split("<<");
          const parts = [];
          while (lines[++i] !== delimiter && i < lines.length) parts.push(lines[i]);
          values[key] = parts.join("\n");
        } else if (lines[i].includes("=")) {
          const at = lines[i].indexOf("=");
          values[lines[i].slice(0, at)] = lines[i].slice(at + 1);
        }
      }
      if (s.id) steps[s.id] = values;
    }
    return {
      code,
      nodes,
      uses,
      requests,
      commands: existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [],
      outputs: Object.fromEntries(
        Object.entries(a.outputs || {}).map(([k, v]) => [k, render(v.value)]),
      ),
    };
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
}
