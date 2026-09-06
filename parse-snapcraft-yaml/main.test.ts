import { expect, test, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../src/project/action.js", () => ({ runParseAction: mocks.run }));

const { main } = await import("./main.js");

test("adapter maps the action environment to its workflow", async () => {
  await main();
  expect(mocks.run).toHaveBeenCalledOnce();
  expect(mocks.run).toHaveBeenCalledWith(process.env);
});
