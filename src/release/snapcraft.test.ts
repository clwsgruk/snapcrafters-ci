import { readFile } from "node:fs/promises";
import { expect, test } from "vite-plus/test";
import { parseRevisions, parseSnapMetadata } from "./snapcraft.js";

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
