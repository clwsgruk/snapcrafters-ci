import { readFile } from "node:fs/promises";
import { expect, test } from "vite-plus/test";
import {
  isRevisionReleased,
  snapcraftRevisionReader,
  parseRevisions,
  parseSnapMetadata,
} from "./snapcraft.js";

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
});

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
