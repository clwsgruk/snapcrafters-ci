import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import {
  isRevisionReleased,
  snapcraftRevisionReader,
  parseRevisions,
  parseSnapMetadata,
} from "./snapcraft.js";
import { parseRevisionRows } from "./store-output.js";

test("parses the immutable Snapcraft revisions table fixture", async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL("../../test/fixtures/snapcraft/upload-output.json", import.meta.url),
      "utf8",
    ),
  ) as { revisions: string };
  expect(parseRevisions(fixture.revisions, "latest/stable", "amd64")).toEqual([
    { revision: "1", architecture: "amd64", version: "2.0.2" },
  ]);
  expect(() => parseRevisions("not a revisions table", "latest/stable", "amd64")).toThrow(
    /header/i,
  );
  expect(isRevisionReleased(fixture.revisions, "1", "latest/stable")).toBe(true);
  expect(isRevisionReleased(fixture.revisions, "2", "latest/stable")).toBe(false);
  expect(() => isRevisionReleased("garbage", "1", "latest/stable")).toThrow(/header/i);
});

test("parses and strictly binds built snap metadata", () => {
  expect(parseSnapMetadata("name: demo\nversion: '1.2'\narchitectures: [amd64]\n")).toEqual({
    name: "demo",
    version: "1.2",
    architecture: "amd64",
  });
  expect(() =>
    parseSnapMetadata("name: demo\nversion: '1.2'\narchitectures: [amd64, arm64]\n"),
  ).toThrow(/one architecture/i);
  for (const source of [
    "[]",
    "name: Bad_Name\nversion: '1'\narchitectures: [amd64]",
    "name: demo\nversion: ''\narchitectures: [amd64]",
    "name: demo\nversion: '1'\narchitectures: [sparc]",
    `name: demo\nversion: '1'\narchitectures: [amd64]\n#${"x".repeat(1024 * 1024)}`,
  ])
    expect(() => parseSnapMetadata(source)).toThrow();
});

test("rejects malformed and ambiguous Store revision rows", () => {
  const header = "Rev.    Uploaded              Arches    Version    Channels\n";
  for (const row of [
    "1 bad",
    "0       2026-09-06T10:00:00Z  amd64     1.0        latest/stable*",
    "1       not-a-date            amd64     1.0        latest/stable*",
    "1       2026-09-06T10:00:00Z  sparc     1.0        latest/stable*",
  ])
    expect(() => parseRevisionRows(header + row)).toThrow();
  expect(parseRevisionRows(`${header}\n`)).toEqual([]);
  const duplicate = `${header}1       2026-09-06T10:00:00Z  amd64     1.0        latest/stable*\n1       2026-09-06T10:00:00Z  arm64     1.0        latest/stable*`;
  expect(() => isRevisionReleased(duplicate, "1", "latest/stable")).toThrow(/ambiguous/i);
  expect(() => isRevisionReleased(header, "0", "latest/stable")).toThrow(/revision/i);
  expect(() => isRevisionReleased(header, "1", "bad")).toThrow(/channel/i);
});

test("parses Snapcraft 9's four-column unreleased revision table", () => {
  const output = `Rev.    Uploaded              Arches    Version
44      2026-09-06T10:00:00Z  amd64     2.0.2
`;
  expect(parseRevisionRows(output)).toEqual([
    { revision: "44", architectures: ["amd64"], version: "2.0.2", channels: [] },
  ]);
});

test("downloads a newly published revision with the snap CLI contract", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "snap-reader-test-"));
  let listing = 0;
  const calls: Array<{ file: string; args: readonly string[] }> = [];
  const reader = snapcraftRevisionReader("token", cwd, async (spec) => {
    calls.push({ file: spec.file, args: spec.args });
    if (spec.file === "snapcraft") {
      listing++;
      const row =
        listing === 1
          ? ""
          : "44      2026-09-06T10:00:00Z  amd64     2.0.2      latest/candidate*\n";
      return result(`Rev.    Uploaded              Arches    Version    Channels\n${row}`);
    }
    if (spec.file === "snap") {
      await writeFile(join(spec.cwd, "demo_44.snap"), "published snap");
      return result("");
    }
    throw new Error(`unexpected executable ${spec.file}`);
  });
  const signal = new AbortController().signal;
  expect(await reader("demo", "latest/candidate", "amd64", signal)).toEqual([]);
  await expect(reader("demo", "latest/candidate", "amd64", signal)).resolves.toMatchObject([
    { revision: "44", version: "2.0.2", architecture: "amd64", digest: expect.any(String) },
  ]);
  expect(calls.at(-1)).toEqual({ file: "snap", args: ["download", "demo", "--revision=44"] });
});

function result(stdout: string) {
  return { exitCode: 0, stdout, stderr: "", timedOut: false, aborted: false };
}

test("does not treat a pre-existing off-channel revision as a new upload", async () => {
  const header = "Rev.    Uploaded              Arches    Version    Channels\n";
  const rows = [
    `${header}2       2026-09-06T10:00:00Z  amd64     1.0        -\n`,
    `${header}2       2026-09-06T10:00:00Z  amd64     1.0        latest/candidate*\n`,
  ];
  let downloads = 0;
  const reader = snapcraftRevisionReader("token", process.cwd(), async (spec) => {
    if (spec.args[0] === "download") downloads++;
    return {
      exitCode: 0,
      stdout: rows.shift() ?? "",
      stderr: "",
      timedOut: false,
      aborted: false,
    };
  });
  expect(await reader("demo", "latest/candidate", "amd64", new AbortController().signal)).toEqual(
    [],
  );
  expect(await reader("demo", "latest/candidate", "amd64", new AbortController().signal)).toEqual([
    { revision: "2", architecture: "amd64", version: "1.0" },
  ]);
  expect(downloads).toBe(0);
});
