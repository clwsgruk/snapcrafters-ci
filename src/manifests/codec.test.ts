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
    expect(() =>
      decodeManifest("name: Bad_Name\narchitecture: amd64\nrevision: 1\n", "manifest-amd64.yaml"),
    ).toThrow(/name/i);
    expect(() => decodeManifest("[]", "manifest-amd64.yaml")).toThrow(/mapping/i);
    expect(() =>
      decodeManifest("name: a\narchitecture: amd64\nrevision: []\n", "manifest-amd64.yaml"),
    ).toThrow(/revision/i);
    expect(() => decodeManifest("x".repeat(65 * 1024), "manifest-amd64.yaml")).toThrow(/size/i);
    expect(() => validateArchiveEntry("C:\\manifest-amd64.yaml", 1, 2)).toThrow(/absolute/i);
    expect(() => validateArchiveEntry("manifest-amd64.txt", 1, 2)).toThrow(/unexpected/i);
    expect(() => validateArchiveEntry("manifest-amd64.yaml", 2, 2)).not.toThrow();
  });
});
