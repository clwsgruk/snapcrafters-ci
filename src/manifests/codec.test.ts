import { describe, expect, test } from "vite-plus/test";
import { decodeManifest, encodeManifest, validateArchiveEntry } from "./codec.js";

describe("legacy manifest codec", () => {
  test("round trips the exact single-snap encoding", () => {
    const text = "name: signal-desktop\narchitecture: amd64\nrevision: 123\n";
    expect(encodeManifest(decodeManifest(text, "manifest-amd64.yaml"))).toBe(text);
  });

  test.each(["../manifest-amd64.yaml", "/tmp/manifest-amd64.yaml", "nested/manifest-amd64.yaml"])(
    "rejects unsafe archive destination %s",
    (name) => expect(() => validateArchiveEntry(name, 10, 100)).toThrow(),
  );

  test("binds filename, architecture, snap, revision, and size", () => {
    expect(() =>
      decodeManifest("name: a\narchitecture: arm64\nrevision: 1\n", "manifest-amd64.yaml"),
    ).toThrow(/architecture/i);
    expect(() =>
      decodeManifest("name: a\narchitecture: amd64\nrevision: 0\n", "manifest-amd64.yaml"),
    ).toThrow(/revision/i);
    expect(() => validateArchiveEntry("manifest-amd64.yaml", 101, 100)).toThrow(/limit/i);
  });
});
