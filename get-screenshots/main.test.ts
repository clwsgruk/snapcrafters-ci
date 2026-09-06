import { expect, test, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../src/screenshots/action.js", () => ({ runScreenshotsAction: mocks.run }));

const { main } = await import("./main.js");

test("adapter maps the action environment to its workflow", async () => {
  await main();
  expect(mocks.run).toHaveBeenCalledOnce();
  expect(mocks.run).toHaveBeenCalledWith(process.env);
});
