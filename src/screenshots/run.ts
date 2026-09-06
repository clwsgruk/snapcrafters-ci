import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Manifest } from "../manifests/codec.js";
import { runProcess } from "../runtime/process.js";

export async function captureScreenshots(input: {
  cwd: string;
  actionPath: string;
  snap: string;
  app: string;
  channel: string;
  manifests: Manifest[];
  signal: AbortSignal;
  path?: string;
  home?: string;
}): Promise<{ screen: Buffer; window: Buffer }> {
  const env = {
    PATH: input.path ?? process.env.PATH ?? "",
    HOME: input.home ?? process.env.HOME ?? input.cwd,
  };
  const amd64 = input.manifests.find((manifest) => manifest.architecture === "amd64");
  if (amd64 && amd64.name !== input.snap) throw new Error("Manifest snap does not match project");
  const commands: Array<[string, string[]]> = [
    ["ghvmctl", ["prepare"]],
    [
      "ghvmctl",
      [
        "snap-install",
        input.snap,
        ...(amd64 ? ["--revision", amd64.revision] : ["--channel", input.channel]),
      ],
    ],
    ["ghvmctl", ["snap-run", `${input.snap}.${input.app}`]],
    [join(input.actionPath, "wait-for-window"), ["60", "2"]],
    ["ghvmctl", ["screenshot-full"]],
    ["ghvmctl", ["screenshot-window"]],
    ["ghvmctl", ["exec", `cat /home/ubuntu/${input.snap}.${input.app}.log`]],
  ];
  for (const [file, args] of commands) {
    const result = await runProcess({
      file,
      args,
      cwd: input.cwd,
      env,
      timeoutMs: 10 * 60_000,
      signal: input.signal,
    });
    if (result.exitCode !== 0) throw new Error(`${file} failed (${result.exitCode})`);
  }
  const directory = join(env.HOME, "ghvmctl-screenshots");
  return {
    screen: await readFile(join(directory, "screenshot-screen.png")),
    window: await readFile(join(directory, "screenshot-window.png")),
  };
}
