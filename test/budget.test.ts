import { test, expect } from "vitest";
import { measure } from "../scripts/size.ts";
test("size gate counts nonblank lines and rejects source/file excess", () => {
  expect(measure(["a\n\n b\n", "c\n"], 3, 2)).toEqual({ lines: 3, files: 2 });
  expect(() => measure(["a\nb"], 1, 2)).toThrow(/line/);
  expect(() => measure(["a", "b"], 3, 1)).toThrow(/file/);
});
