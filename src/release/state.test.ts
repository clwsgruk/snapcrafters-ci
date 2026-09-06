import { mkdtemp, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { readReleaseState } from "./read-state.js";
import { parseReleaseState } from "./state.js";

const valid = {
  snap: "demo",
  version: "1.0",
  revision: "44",
  channel: "latest/candidate",
  architecture: "amd64",
  digest: "a".repeat(96),
  sourceSha: "b".repeat(40),
};

test("strictly parses fully bound release state", () => {
  expect(parseReleaseState(JSON.stringify(valid))).toEqual(valid);
  for (const override of [
    { snap: "Bad_Name" },
    { version: "" },
    { revision: "0" },
    { channel: "bad" },
    { architecture: "sparc" },
    { digest: "bad" },
    { sourceSha: "bad" },
  ])
    expect(() => parseReleaseState(JSON.stringify({ ...valid, ...override }))).toThrow();
  expect(() => parseReleaseState("x".repeat(4097))).toThrow(/size/i);
  expect(() => parseReleaseState("null")).toThrow(/state/i);
});

test("reads release state only from a bounded regular file", async () => {
  const root = await mkdtemp(join(tmpdir(), "release-state-"));
  const state = join(root, "state.json");
  await writeFile(state, JSON.stringify(valid));
  await expect(readReleaseState(state)).resolves.toEqual(valid);
  await truncate(state, 4097);
  await expect(readReleaseState(state)).rejects.toThrow(/size/i);
  const target = join(root, "target.json");
  const linked = join(root, "linked.json");
  await writeFile(target, JSON.stringify(valid));
  await symlink(target, linked);
  await expect(readReleaseState(linked)).rejects.toThrow();
});
