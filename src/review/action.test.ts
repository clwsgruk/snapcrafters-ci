import { expect, test } from "vite-plus/test";
import type { Project } from "../project/types.js";
import type { ProcessSpec } from "../runtime/process.js";
import { runBuildReviewActionWith } from "./action.js";

test("local build review forwards classic and declaration files", async () => {
  let reviewed: unknown;
  let installed: ProcessSpec | undefined;
  const project = {
    root: "/work/snap",
    yamlPath: "/work/snap/snapcraft.yaml",
    publicRoot: "snap",
    publicYamlPath: "snap/snapcraft.yaml",
    name: "demo",
    version: "1",
    classic: true,
    components: [],
    plugsFile: ".github/plug-declaration.json",
    slotsFile: ".github/slot-declaration.json",
    document: {},
  } satisfies Project;
  await runBuildReviewActionWith(
    { INPUT_SNAP: "/work/demo.snap", INPUT_INSTALL: "true" },
    {
      context: async () => ({
        workspace: "/work",
        repository: "apps/demo",
        runId: "1",
        sha: "a".repeat(40),
        eventName: "push",
        event: {},
      }),
      parse: async () => project,
      review: async (input) => {
        reviewed = input;
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false, aborted: false };
      },
      run: async (spec) => {
        installed = spec;
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false, aborted: false };
      },
    },
  );
  expect(reviewed).toEqual({
    snap: "/work/demo.snap",
    classic: true,
    plugs: "/work/.github/plug-declaration.json",
    slots: "/work/.github/slot-declaration.json",
  });
  expect(installed?.args).toContain("/work/demo.snap");
});
