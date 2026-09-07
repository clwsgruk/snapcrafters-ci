import { test, expect } from "vitest";

import { measure, productionSources } from "./size.ts";
test("size gate counts nonblank lines and rejects source/file excess", () => {
  expect(measure(["a\n\n b\n", "c\n"], 3, 2)).toEqual({ lines: 3, files: 2 });
  expect(() => measure(["a\nb"], 1, 2)).toThrow(/line/);
  expect(() => measure(["a", "b"], 3, 1)).toThrow(/file/);
  expect(productionSources(["src/a.ts", "README.md"])).toEqual(["src/a.ts"]);
  expect(productionSources(["src/a.ts", "src/a.test.ts"])).toEqual(["src/a.ts"]);
  expect(() => productionSources(["src/a.ts", "src/hidden.js"])).toThrow(/unsupported/i);
});
