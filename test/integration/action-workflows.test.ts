import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  setSecret: vi.fn(),
  setOutput: vi.fn(),
  warning: vi.fn(),
  context: vi.fn(),
  dispose: vi.fn(),
  collect: vi.fn(),
  parseProject: vi.fn(),
  process: vi.fn(),
  promote: vi.fn(),
  review: vi.fn(),
  setup: vi.fn(),
  capture: vi.fn(),
  publish: vi.fn(),
  createIssue: vi.fn(),
  runTests: vi.fn(),
  update: vi.fn(),
  comment: vi.fn(),
  manifestGitHub: vi.fn(),
  promotionGitHub: vi.fn(),
  screenshotGitHub: vi.fn(),
  issueCreator: vi.fn(),
}));

vi.mock("@actions/core", () => ({
  setSecret: mocks.setSecret,
  setOutput: mocks.setOutput,
  warning: mocks.warning,
}));
vi.mock("../../src/actions/context.js", () => ({ actionContext: mocks.context }));
vi.mock("../../src/actions/signal.js", () => ({
  actionSignal: () => ({ signal: new AbortController().signal, dispose: mocks.dispose }),
}));
vi.mock("../../src/manifests/collect.js", () => ({ collectManifests: mocks.collect }));
vi.mock("../../src/project/parse.js", () => ({ parseProject: mocks.parseProject }));
vi.mock("../../src/runtime/process.js", () => ({ runProcess: mocks.process }));
vi.mock("../../src/runtime/github.js", () => ({
  manifestGitHub: mocks.manifestGitHub,
  promotionGitHub: mocks.promotionGitHub,
  screenshotGitHub: mocks.screenshotGitHub,
  issueCommenter: () => mocks.comment,
  issueCreator: mocks.issueCreator,
}));
vi.mock("../../src/promotion/run.js", () => ({ promote: mocks.promote }));
vi.mock("../../src/review/run.js", () => ({ runReview: mocks.review }));
vi.mock("../../src/screenshots/setup.js", () => ({ runGhvmctlSetupAction: mocks.setup }));
vi.mock("../../src/screenshots/run.js", () => ({ captureScreenshots: mocks.capture }));
vi.mock("../../src/screenshots/upload.js", () => ({ publishScreenshots: mocks.publish }));
vi.mock("../../src/testing/issue.js", () => ({ createTestingIssue: mocks.createIssue }));
vi.mock("../../src/testing/run.js", () => ({ runTests: mocks.runTests }));
vi.mock("../../src/update/run.js", () => ({ runUpdate: mocks.update }));

const { runFetchManifestsAction } = await import("../../src/manifests/action.js");
const { runArchitecturesAction, runParseAction } = await import("../../src/project/action.js");
const { runPromotionAction } = await import("../../src/promotion/action.js");
const { runReviewAction } = await import("../../src/review/action.js");
const { runScreenshotsAction } = await import("../../src/screenshots/action.js");
const { runTestingIssueAction, runTestsAction } = await import("../../src/testing/action.js");
const { runUpdateAction } = await import("../../src/update/action.js");

const project = () => ({
  name: "demo",
  version: "1.0",
  base: "core24",
  classic: true,
  components: [{ name: "docs", version: "1" }],
  plugsFile: ".github/plug-declaration.json",
  slotsFile: ".github/slot-declaration.json",
  publicRoot: ".",
  publicYamlPath: "./snap/snapcraft.yaml",
  absoluteRoot: "/workspace",
  yamlPath: "/workspace/snap/snapcraft.yaml",
  document: { base: "core24", platforms: { amd64: null } },
});

const event = () => ({
  action: "created",
  issue: { number: 7 },
  comment: {
    id: 9,
    body: "/promote 44 latest/stable done",
    user: { login: "maintainer" },
    created_at: "2026-09-06T10:00:00Z",
    updated_at: "2026-09-06T10:00:00Z",
  },
});

const baseEnv = (): NodeJS.ProcessEnv => ({
  INPUT_GITHUB_TOKEN: "github-token",
  INPUT_STORE_TOKEN: "store-token",
  INPUT_TOKEN: "token",
  INPUT_ARCHITECTURES: "amd64",
  INPUT_ISSUE_NUMBER: "7",
  INPUT_SCREENSHOTS_TOKEN: "screenshots-token",
  INPUT_TEST_SCRIPT: "printf ok",
  INPUT_UPDATE_SCRIPT: "printf update",
  INPUT_SNAP: "/workspace/demo.snap",
  GITHUB_ACTION_PATH: "/action",
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({
    workspace: "/workspace",
    repository: "apps/demo",
    runId: "8",
    sha: "a".repeat(40),
    eventName: "issue_comment",
    event: event(),
  });
  mocks.parseProject.mockResolvedValue(project());
  mocks.collect.mockResolvedValue([]);
  mocks.process.mockResolvedValue({
    exitCode: 0,
    stdout:
      "Rev.    Uploaded              Arches    Version    Channels\n44      2026-09-06T10:00:00Z  amd64     1.0        latest/stable*\n",
    stderr: "",
    timedOut: false,
    aborted: false,
  });
  mocks.createIssue.mockResolvedValue(17);
  mocks.runTests.mockResolvedValue({ exitCode: 0, commentBody: "ok", log: "ok" });
  mocks.capture.mockResolvedValue({
    screen: Buffer.from("screen"),
    window: Buffer.from("window"),
  });
  mocks.publish.mockResolvedValue({ screen: "screen-url", window: "window-url" });
  mocks.update.mockImplementation(async (input: { message: string | (() => Promise<string>) }) => {
    if (typeof input.message === "function") await input.message();
    return { changed: true };
  });
});

describe("action workflow orchestration", () => {
  test("fetch manifests succeeds and missing auth fails before reads", async () => {
    await runFetchManifestsAction(baseEnv());
    expect(mocks.collect).toHaveBeenCalledOnce();
    expect(mocks.dispose).toHaveBeenCalledOnce();
    mocks.collect.mockClear();
    await expect(runFetchManifestsAction({})).rejects.toThrow(/token/i);
    expect(mocks.collect).not.toHaveBeenCalled();
  });

  test("project adapters publish every parsed field and exact architecture encodings", async () => {
    await runParseAction(baseEnv());
    expect(mocks.setOutput).toHaveBeenCalledWith("version", "1.0");
    expect(mocks.setOutput).toHaveBeenCalledWith("classic", "true");
    await runArchitecturesAction(baseEnv());
    expect(mocks.setOutput).toHaveBeenCalledWith("architectures", "amd64");
    expect(mocks.setOutput).toHaveBeenCalledWith("architectures_list", '["amd64"]');
    mocks.parseProject.mockRejectedValueOnce(new Error("bad project"));
    await expect(runParseAction(baseEnv())).rejects.toThrow("bad project");
  });

  test("promotion validates before install and exposes bounded Store closures", async () => {
    await runPromotionAction(baseEnv());
    expect(mocks.process.mock.calls[0]?.[0]).toMatchObject({ file: "sudo" });
    const dependencies = mocks.promote.mock.calls[0]?.[1] as {
      release(revision: string, channel: string): Promise<void>;
      isReleased(revision: string, channel: string): Promise<boolean>;
    };
    await dependencies.release("44", "latest/stable");
    await expect(dependencies.isReleased("44", "latest/stable")).resolves.toBe(true);
    expect(mocks.dispose).toHaveBeenCalledOnce();

    mocks.context.mockResolvedValueOnce({
      ...(await mocks.context()),
      event: { ...event(), issue: { number: 7, pull_request: {} } },
    });
    mocks.process.mockClear();
    await expect(runPromotionAction(baseEnv())).rejects.toThrow(/pull requests/i);
    expect(mocks.process).not.toHaveBeenCalled();

    mocks.process.mockResolvedValueOnce({
      exitCode: 3,
      stdout: "",
      stderr: "",
      timedOut: false,
      aborted: false,
    });
    await expect(runPromotionAction(baseEnv())).rejects.toThrow(/installing.*3/i);
    expect(mocks.promote).toHaveBeenCalledTimes(1);
  });

  test("review maps optional inputs and preserves a review failure", async () => {
    await runReviewAction({
      INPUT_SNAP: "/workspace/demo.snap",
      INPUT_PLUGS: "plugs.json",
      INPUT_SLOTS: "slots.json",
      INPUT_IS_CLASSIC: "true",
    });
    expect(mocks.review.mock.calls[0]?.[0]).toMatchObject({
      classic: true,
      plugs: "plugs.json",
      slots: "slots.json",
    });
    mocks.review.mockRejectedValueOnce(new Error("review failed"));
    await expect(runReviewAction({ INPUT_SNAP: "demo.snap" })).rejects.toThrow("review failed");
    expect(mocks.dispose).toHaveBeenCalledTimes(2);
  });

  test("screenshots keep auth routes isolated and fail before setup on legacy overrides", async () => {
    await runScreenshotsAction(baseEnv());
    expect(mocks.setup).toHaveBeenCalledOnce();
    expect(mocks.publish.mock.calls[0]?.[1]).toMatchObject({ comment: mocks.comment });
    expect(mocks.setOutput).toHaveBeenCalledWith("screen", "screen-url");
    expect(mocks.setOutput).toHaveBeenCalledWith("window", "window-url");
    mocks.setup.mockClear();
    await expect(runScreenshotsAction({ ...baseEnv(), INPUT_CI_REPO: "fork/ci" })).rejects.toThrow(
      /immutable SHA/i,
    );
    expect(mocks.setup).not.toHaveBeenCalled();
    mocks.publish.mockRejectedValueOnce(new Error("publish failed"));
    await expect(runScreenshotsAction(baseEnv())).rejects.toThrow("publish failed");
    expect(mocks.dispose).toHaveBeenCalledTimes(2);
  });

  test("testing issue uses manifests without Store writes and reports creation failures", async () => {
    mocks.collect.mockResolvedValueOnce([
      { name: "demo", architecture: "amd64", revision: "44", version: "1.0" },
    ]);
    await runTestingIssueAction(baseEnv());
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.setOutput).toHaveBeenCalledWith("number", "17");
    mocks.createIssue.mockRejectedValueOnce(new Error("issue failed"));
    await expect(runTestingIssueAction(baseEnv())).rejects.toThrow("issue failed");
    expect(mocks.dispose).toHaveBeenCalledTimes(2);
  });

  test("testing issue performs one strict Store setup for repeated manifest fallbacks", async () => {
    mocks.createIssue.mockImplementationOnce(
      async (
        _input: unknown,
        dependencies: {
          lookup(snap: string, architecture: string, channel: string): Promise<unknown>;
        },
      ) => {
        await dependencies.lookup("demo", "amd64", "latest/candidate");
        await dependencies.lookup("demo", "amd64", "latest/candidate");
        return 19;
      },
    );
    await runTestingIssueAction(baseEnv());
    expect(mocks.process).toHaveBeenCalledTimes(3);
    expect(mocks.process.mock.calls.filter(([spec]) => spec.file === "sudo")).toHaveLength(1);

    mocks.createIssue.mockImplementationOnce(
      async (_input: unknown, dependencies: { lookup(): Promise<unknown> }) =>
        dependencies.lookup(),
    );
    mocks.process.mockClear();
    const env = baseEnv();
    delete env.INPUT_STORE_TOKEN;
    await expect(runTestingIssueAction(env)).rejects.toThrow(/store-token.*required/i);
    expect(mocks.process).not.toHaveBeenCalled();
  });

  test("test runner fails before script on install errors and after script on test failure", async () => {
    mocks.process.mockResolvedValueOnce({
      exitCode: 4,
      stdout: "",
      stderr: "",
      timedOut: false,
      aborted: false,
    });
    await expect(runTestsAction(baseEnv())).rejects.toThrow(/dpkg.*4/i);
    expect(mocks.runTests).not.toHaveBeenCalled();

    mocks.process.mockResolvedValue({
      exitCode: 0,
      stdout: "amd64\n",
      stderr: "",
      timedOut: false,
      aborted: false,
    });
    mocks.runTests.mockResolvedValueOnce({
      exitCode: 2,
      commentBody: "failed",
      log: "failed",
      commentError: new Error("comment failed"),
    });
    await expect(runTestsAction(baseEnv())).rejects.toThrow(/tests failed.*2/i);
    expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining("comment failed"));
    expect(mocks.dispose).toHaveBeenCalledTimes(2);
  });

  test("update derives its message after the update and disposes on downstream failure", async () => {
    mocks.parseProject
      .mockResolvedValueOnce(project())
      .mockResolvedValueOnce({ ...project(), version: "2.0" });
    await runUpdateAction(baseEnv());
    expect(mocks.parseProject).toHaveBeenCalledTimes(2);
    mocks.update.mockRejectedValueOnce(new Error("push failed"));
    await expect(runUpdateAction(baseEnv())).rejects.toThrow("push failed");
    expect(mocks.dispose).toHaveBeenCalledTimes(2);
  });
});
