import { describe, expect, test } from "vite-plus/test";
import {
  architecture,
  architectureList,
  boolean,
  channel,
  optional,
  positiveDecimal,
  repository,
  required,
} from "./inputs.js";

describe("public input validation", () => {
  test("accepts only exact booleans, positive decimal identifiers, and supported architectures", () => {
    expect(boolean("false", "flag")).toBe(false);
    expect(positiveDecimal("10", "issue")).toBe("10");
    expect(architecture("i386")).toBe("i386");
    expect(architectureList("amd64 arm64")).toEqual(["amd64", "arm64"]);
    for (const value of ["TRUE", " false", "1"]) expect(() => boolean(value, "flag")).toThrow();
    for (const value of ["0", "-1", "1\n2"])
      expect(() => positiveDecimal(value, "issue")).toThrow();
    expect(() => architectureList("amd64 amd64")).toThrow(/duplicate/i);
    expect(() => architecture("--amd64")).toThrow(/architecture/i);
  });

  test("accepts real Snapcraft tracks while rejecting newlines and leading options", () => {
    expect(channel("8.x/candidate")).toBe("8.x/candidate");
    expect(channel("latest/stable/hot-fix")).toBe("latest/stable/hot-fix");
    for (const value of ["--latest/stable", "latest/stable\nedge", "latest/unknown"])
      expect(() => channel(value)).toThrow();
  });

  test("strictly parses github.com owner/repository names", () => {
    expect(repository("snapcrafters/ci")).toEqual({ owner: "snapcrafters", name: "ci" });
    for (const value of ["snapcrafters", "-owner/repo", "owner/../repo", "owner/repo\nnext"])
      expect(() => repository(value)).toThrow();
  });

  test("bounds required raw inputs while preserving trusted multiline scripts", () => {
    expect(required({ INPUT_TEST_SCRIPT: "one\ntwo" }, "test-script", 20)).toBe("one\ntwo");
    expect(optional({ INPUT_ROOT: "nested" }, "root", "fallback")).toBe("nested");
    expect(optional({}, "root", "fallback")).toBe("fallback");
    expect(optional({ INPUT_ROOT: "" }, "root", "fallback")).toBe("fallback");
    expect(() => required({}, "missing")).toThrow(/required/i);
    expect(() => required({ INPUT_VALUE: "12345" }, "value", 4)).toThrow(/size/i);
    expect(() => required({ INPUT_VALUE: "a\0b" }, "value")).toThrow(/NUL/i);
  });
});
