import { constants } from "node:fs";
import { lstat, open, readlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { Manifest } from "../manifests/codec.js";
import { ownedTemp, removeOwned } from "../runtime/files.js";
import { runProcess } from "../runtime/process.js";
import { validateCaptureRequest } from "./validation.js";

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
  owner?: string;
}): Promise<{ screen: Buffer; window: Buffer }> {
  const amd64 = validateCaptureRequest(input);
  const helper = join(input.actionPath, "wait-for-window");
  const helperMetadata = await lstat(helper, { bigint: false });
  if (
    helperMetadata.isSymbolicLink() ||
    !helperMetadata.isFile() ||
    (helperMetadata.mode & 0o111) === 0
  )
    throw new Error("Screenshot helper must be an executable regular file");
  const owner = input.owner ?? `${process.pid}-${Date.now()}`;
  if (!/^[A-Za-z0-9-]{1,80}$/.test(owner)) throw new Error("Invalid screenshot owner");
  const scratch = await ownedTemp(input.home ?? input.cwd, ".snapcrafters-screenshots-", owner);
  const vmName = `snapcrafters-${owner}`.toLowerCase();
  const env = {
    PATH: input.path ?? process.env.PATH ?? "",
    HOME: scratch,
    SNAP_REAL_HOME: scratch,
    VM_NAME: vmName,
  };
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
    [helper, ["60", "2"]],
    ["ghvmctl", ["screenshot-full"]],
    ["ghvmctl", ["screenshot-window"]],
    ["ghvmctl", ["exec", "cat", "--", `/home/ubuntu/${input.snap}.${input.app}.log`]],
  ];
  let failure: unknown;
  let images: { screen: Buffer; window: Buffer } | undefined;
  const cleanupErrors: unknown[] = [];
  try {
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
    const directory = join(scratch, "ghvmctl-screenshots");
    images = {
      screen: await readPng(join(directory, "screenshot-screen.png")),
      window: await readPng(join(directory, "screenshot-window.png")),
    };
  } catch (error) {
    failure = error;
  } finally {
    try {
      const result = await runProcess({
        file: "lxc",
        args: ["delete", "--force", vmName],
        cwd: input.cwd,
        env,
        timeoutMs: 60_000,
        signal: new AbortController().signal,
      });
      if (result.exitCode !== 0)
        cleanupErrors.push(new Error(`lxc cleanup failed (${result.exitCode})`));
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await removeOwned(scratch, owner);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (failure !== undefined) throw failure;
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Screenshot cleanup failed");
  if (!images) throw new Error("Screenshots were not captured");
  return images;
}

export async function readPng(path: string): Promise<Buffer> {
  const limit = 10 * 1024 * 1024;
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("Screenshot ownership cannot be verified");
  const aliasMetadata = await lstat(path);
  if (aliasMetadata.uid !== uid) throw new Error("Screenshot alias has an unexpected owner");
  let targetPath = path;
  if (aliasMetadata.isSymbolicLink()) {
    const alias = basename(path);
    const kind = /^screenshot-(screen|window)\.png$/.exec(alias)?.[1];
    const target = await readlink(path);
    if (
      !kind ||
      target !== basename(target) ||
      !new RegExp(`^screenshot-${kind}-[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}\\.png$`).test(target)
    )
      throw new Error("Screenshot alias target is invalid");
    targetPath = resolve(dirname(path), target);
    if (dirname(targetPath) !== dirname(path))
      throw new Error("Screenshot alias escapes its capture directory");
  } else if (!aliasMetadata.isFile()) {
    throw new Error("Screenshot alias must be a regular file or constrained symlink");
  }
  const handle = await open(targetPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    const current = await lstat(targetPath);
    if (
      current.isSymbolicLink() ||
      !metadata.isFile() ||
      metadata.uid !== uid ||
      current.uid !== uid ||
      metadata.dev !== current.dev ||
      metadata.ino !== current.ino ||
      metadata.size < 8 ||
      metadata.size > limit
    )
      throw new Error("Screenshot must be a non-empty bounded regular PNG file");
    const buffer = Buffer.alloc(metadata.size);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== buffer.length) throw new Error("Screenshot changed while reading");
    if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      throw new Error("Screenshot does not have a PNG signature");
    return buffer;
  } finally {
    await handle.close();
  }
}
