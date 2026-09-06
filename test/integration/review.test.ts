import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { runReview } from "../../src/review/run.js";

test("uses controlled snap/review binaries and preserves argument boundaries", async () => {
  const root = await mkdtemp(join(tmpdir(), "review integration-"));
  const bin = join(root, "bin");
  const log = join(root, "args.log");
  const marker = join(root, "must-not-exist");
  await mkdir(bin);
  await writeFile(join(bin, "snap"), "#!/bin/bash\nexit 1\n", { mode: 0o700 });
  await writeFile(join(bin, "sudo"), `#!/bin/bash\nprintf '%s\\n' "$@" >> '${log}'\n`, {
    mode: 0o700,
  });
  const reviewer = join(bin, "review-tools.snap-review");
  await writeFile(reviewer, `#!/bin/bash\nprintf '%s\\n' "$@" >> '${log}'\n`, { mode: 0o700 });
  await runReview(
    {
      snap: `snap-$(touch '${marker}').snap`,
      plugs: "plugs file",
      slots: "slots file",
      classic: true,
      path: `${bin}:${process.env.PATH ?? ""}`,
    },
    root,
    new AbortController().signal,
  );
  expect(await readFile(log, "utf8")).toContain("--allow-classic\n");
  expect(await readFile(log, "utf8")).toContain("plugs file\n");
  await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  await writeFile(reviewer, "#!/bin/bash\nexit 9\n", { mode: 0o700 });
  await expect(
    runReview(
      { snap: "demo.snap", classic: false, path: `${bin}:${process.env.PATH ?? ""}` },
      root,
      new AbortController().signal,
    ),
  ).rejects.toThrow(/review failed \(9\)/i);
});
