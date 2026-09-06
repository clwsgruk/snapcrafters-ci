import { access, chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { captureScreenshots } from "../../src/screenshots/run.js";

test("runs ghvmctl with argument arrays and exact amd64 manifest binding", async () => {
  const root = await mkdtemp(join(tmpdir(), "screenshots integration-"));
  const bin = join(root, "bin");
  const home = join(root, "home");
  const actionPath = join(root, "action");
  const log = join(root, "arguments.log");
  const marker = join(root, "must-not-exist");
  await mkdir(bin);
  await mkdir(actionPath);
  const ghvmctl = join(bin, "ghvmctl");
  await writeFile(
    ghvmctl,
    `#!/bin/bash
printf '%s\n' "$@" >> '${log}'
mkdir -p "$HOME/ghvmctl-screenshots"
case "$1" in
  screenshot-full) printf screen > "$HOME/ghvmctl-screenshots/screenshot-screen.png" ;;
  screenshot-window) printf window > "$HOME/ghvmctl-screenshots/screenshot-window.png" ;;
esac
`,
    { mode: 0o700 },
  );
  const wait = join(actionPath, "wait-for-window");
  await writeFile(wait, "#!/bin/bash\nexit 0\n", { mode: 0o700 });
  await chmod(wait, 0o700);
  const images = await captureScreenshots({
    cwd: root,
    actionPath,
    snap: "demo",
    app: `app-$(touch '${marker}')`,
    channel: "latest/candidate",
    manifests: [{ name: "demo", architecture: "amd64", revision: "12" }],
    signal: new AbortController().signal,
    path: `${bin}:${process.env.PATH ?? ""}`,
    home,
  });
  expect(images).toEqual({ screen: Buffer.from("screen"), window: Buffer.from("window") });
  expect(await readFile(log, "utf8")).toContain("--revision\n12\n");
  await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
});

test("rejects a wrong-snap manifest before invoking ghvmctl", async () => {
  const root = await mkdtemp(join(tmpdir(), "screenshots integration-"));
  await expect(
    captureScreenshots({
      cwd: root,
      actionPath: root,
      snap: "demo",
      app: "demo",
      channel: "latest/candidate",
      manifests: [{ name: "other", architecture: "amd64", revision: "12" }],
      signal: new AbortController().signal,
      path: "/missing",
      home: root,
    }),
  ).rejects.toThrow(/manifest snap/i);
});
