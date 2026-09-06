import { expect, test } from "vite-plus/test";
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
