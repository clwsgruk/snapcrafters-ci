import { createHash } from "node:crypto";
import { access, mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, test } from "vite-plus/test";
import { PartialPublicationError } from "../runtime/errors.js";
import type { ProcessResult, ProcessSpec } from "../runtime/process.js";
import { parseUploadRevision, recordReleaseTag, runRelease } from "./run.js";
import type { StoreRevision } from "./types.js";

const ok: ProcessResult = {
  exitCode: 0,
  stdout: "",
  stderr: "",
  timedOut: false,
  aborted: false,
};

test("parses only the captured Snapcraft upload message for the expected snap", async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL("../../test/fixtures/snapcraft/upload-output.json", import.meta.url),
      "utf8",
    ),
  ) as { message: string; snapcraftCommit: string; publicRunHeadSha: string };
  expect(fixture.snapcraftCommit).toMatch(/^[0-9a-f]{40}$/);
  expect(fixture.publicRunHeadSha).toMatch(/^[0-9a-f]{40}$/);
  expect(parseUploadRevision(fixture.message, "basic")).toBe("10");
  expect(() => parseUploadRevision("Revision 10 of 'basic' created.\n", "basic")).toThrow();
  expect(() => parseUploadRevision("Revision 10 created for 'other'\n", "basic")).toThrow(/snap/i);
  expect(() =>
    parseUploadRevision(
      "Revision 10 created for 'basic'\nRevision 11 created for 'basic'\n",
      "basic",
    ),
  ).toThrow(/ambiguous/i);
});

async function recipe(
  source: string,
): Promise<{ workspace: string; tempRoot: string; signal: AbortSignal }> {
  const workspace = await mkdtemp(join(tmpdir(), "release-workspace-"));
  const tempRoot = await mkdtemp(join(tmpdir(), "release-scratch-"));
  await mkdir(join(workspace, "nested", "snap"), { recursive: true });
  await writeFile(join(workspace, "nested", "snap", "snapcraft.yaml"), source);
  return { workspace, tempRoot, signal: new AbortController().signal };
}

function digest(contents: string): string {
  return createHash("sha3-384").update(contents).digest("hex");
}

describe("staged release", () => {
  test("rejects malformed tag identity before running Git", async () => {
    let runs = 0;
    await expect(
      recordReleaseTag(
        {
          cwd: process.cwd(),
          name: "demo",
          version: "1.0",
          revision: "1",
          architecture: "amd64",
          multiSnap: false,
          botName: "bot\nname",
          botEmail: "bot@example.invalid",
        },
        async () => {
          runs++;
          return ok;
        },
      ),
    ).rejects.toThrow(/identity|name/i);
    expect(runs).toBe(0);
  });

  test("builds an adopted version from nested core22 staging with exact readback binding", async () => {
    const input = await recipe(
      "name: demo\nbase: core22\nadopt-info: demo\narchitectures:\n  - build-on: amd64\n    run-on: [amd64, i386]\n",
    );
    const specs: ProcessSpec[] = [];
    const readbacks: StoreRevision[][] = [
      [],
      [
        {
          revision: "44",
          architecture: "i386",
          version: "9.4",
          digest: digest("fresh snap"),
        },
      ],
    ];
    const publications: string[] = [];
    let stagedDocument: Record<string, unknown> | undefined;
    const result = await runRelease(
      {
        ...input,
        projectRoot: "nested/",
        architecture: "i386",
        channel: "latest/candidate",
        snapcraftChannel: "8.x/candidate",
        launchpadToken: "launchpad-secret",
        storeToken: "store-secret",
        sourceSha: "a".repeat(40),
      },
      {
        run: async (spec) => {
          specs.push(spec);
          if (spec.file === "snapcraft" && spec.args[0] === "remote-build") {
            stagedDocument = parse(
              await readFile(join(spec.cwd, "snap", "snapcraft.yaml"), "utf8"),
            ) as Record<string, unknown>;
            await writeFile(join(spec.cwd, "demo_9.4_i386.snap"), "fresh snap");
          }
          if (spec.file === "snapcraft" && spec.args[0] === "upload") {
            return {
              ...ok,
              stdout: "Revision 44 created for 'demo' and released to 'latest/candidate'\n",
            };
          }
          return ok;
        },
        inspectSnap: async () => ({ name: "demo", version: "9.4", architecture: "i386" }),
        review: async () => undefined,
        readback: async () => readbacks.shift()!,
        recordPublication: async ({ revision }) => {
          publications.push(revision);
        },
        writeManifest: async (path, contents) => writeFile(path, contents, { flag: "wx" }),
      },
    );
    expect(result.published).toMatchObject({ revision: "44", version: "9.4" });
    expect(publications).toEqual(["44"]);
    expect(readbacks).toEqual([]);
    expect(stagedDocument?.architectures).toEqual([{ "build-on": ["amd64"], "run-on": ["i386"] }]);
    expect(
      specs.find((spec) => spec.file === "snapcraft" && spec.args[0] === "remote-build")?.args,
    ).not.toContain("--build-for=i386");
    expect(specs.some((spec) => spec.file === "git" && spec.args.includes("init"))).toBe(true);
    expect(specs.some((spec) => spec.file === "git" && spec.args.includes("add"))).toBe(true);
    expect(specs.find((spec) => spec.file === "sudo")?.args).toContain("8.x/candidate");
    await expect(
      access(specs.find((spec) => spec.file === "snapcraft")!.cwd),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("does not accept a pre-existing revision after an ambiguous upload", async () => {
    const input = await recipe("name: demo\nbase: core24\nversion: '1.2'\nplatforms:\n  amd64:\n");
    const existing: StoreRevision = {
      revision: "41",
      architecture: "amd64",
      version: "1.2",
      digest: digest("fresh snap"),
    };
    let reads = 0;
    let uploads = 0;
    let recorded = false;
    let buildArgs: readonly string[] = [];
    await expect(
      runRelease(
        {
          ...input,
          projectRoot: "nested",
          architecture: "amd64",
          channel: "latest/candidate",
          snapcraftChannel: "latest/stable",
          launchpadToken: "lp",
          storeToken: "store",
          sourceSha: "b".repeat(40),
        },
        {
          run: async (spec) => {
            if (spec.args[0] === "remote-build") {
              buildArgs = spec.args;
              await writeFile(join(spec.cwd, "demo_1.2_amd64.snap"), "fresh snap");
            }
            if (spec.args[0] === "upload") {
              uploads++;
              return { ...ok, exitCode: 1, stderr: "connection closed" };
            }
            return ok;
          },
          inspectSnap: async () => ({ name: "demo", version: "1.2", architecture: "amd64" }),
          review: async () => undefined,
          readback: async () => {
            reads++;
            return [existing];
          },
          recordPublication: async () => {
            recorded = true;
          },
          writeManifest: async () => undefined,
        },
      ),
    ).rejects.toThrow(/ambiguous.*publication/i);
    expect({ reads, uploads, recorded }).toEqual({ reads: 2, uploads: 1, recorded: false });
    expect(buildArgs).toContain("--build-for=amd64");
  });

  test("keeps remote-build failure and missing components before every Store write", async () => {
    const input = await recipe(
      "name: demo\nbase: core24\nversion: '1.2'\nplatforms:\n  amd64:\ncomponents:\n  docs:\n    version: '1'\n",
    );
    let uploads = 0;
    let reads = 0;
    const dependencies = {
      run: async (spec: ProcessSpec) => {
        if (spec.args[0] === "remote-build")
          await writeFile(join(spec.cwd, "demo_1.2_amd64.snap"), "fresh snap");
        if (spec.args[0] === "upload") uploads++;
        return ok;
      },
      inspectSnap: async () => ({
        name: "demo" as const,
        version: "1.2",
        architecture: "amd64" as const,
      }),
      review: async () => undefined,
      readback: async () => {
        reads++;
        return [];
      },
      recordPublication: async () => undefined,
      writeManifest: async () => undefined,
    };
    await expect(
      runRelease(
        {
          ...input,
          projectRoot: "nested",
          architecture: "amd64",
          channel: "latest/candidate",
          snapcraftChannel: "latest/stable",
          launchpadToken: "lp",
          storeToken: "store",
          sourceSha: "e".repeat(40),
        },
        dependencies,
      ),
    ).rejects.toThrow(/component.*missing/i);
    expect({ uploads, reads }).toEqual({ uploads: 0, reads: 0 });
  });

  test("reports a known publication when immediate journaling fails", async () => {
    const input = await recipe("name: demo\nbase: core24\nversion: '1.2'\nplatforms:\n  amd64:\n");
    let read = 0;
    const operation = runRelease(
      {
        ...input,
        projectRoot: "nested",
        architecture: "amd64",
        channel: "latest/candidate",
        snapcraftChannel: "latest/stable",
        launchpadToken: "lp",
        storeToken: "store",
        sourceSha: "c".repeat(40),
      },
      {
        run: async (spec) => {
          if (spec.args[0] === "remote-build")
            await writeFile(join(spec.cwd, "demo_1.2_amd64.snap"), "fresh snap");
          if (spec.args[0] === "upload")
            return { ...ok, stdout: "Revision 44 created for 'demo'\n" };
          return ok;
        },
        inspectSnap: async () => ({ name: "demo", version: "1.2", architecture: "amd64" }),
        review: async () => undefined,
        readback: async () =>
          read++ === 0
            ? []
            : [
                {
                  revision: "44",
                  architecture: "amd64",
                  version: "1.2",
                  digest: digest("fresh snap"),
                },
              ],
        recordPublication: async () => {
          throw new Error("journal unavailable");
        },
        writeManifest: async () => undefined,
      },
    );
    await expect(operation).rejects.toBeInstanceOf(PartialPublicationError);
    await expect(operation).rejects.toThrow(/published revision 44.*record/i);
  });

  test("reports ambiguous partial state when readback fails after an upload attempt", async () => {
    const input = await recipe("name: demo\nbase: core24\nversion: '1.2'\nplatforms:\n  amd64:\n");
    let read = 0;
    const operation = runRelease(
      {
        ...input,
        projectRoot: "nested",
        architecture: "amd64",
        channel: "latest/candidate",
        snapcraftChannel: "latest/stable",
        launchpadToken: "lp",
        storeToken: "store",
        sourceSha: "f".repeat(40),
      },
      {
        run: async (spec) => {
          if (spec.args[0] === "remote-build")
            await writeFile(join(spec.cwd, "demo_1.2_amd64.snap"), "fresh snap");
          if (spec.args[0] === "upload")
            return { ...ok, exitCode: 1, stderr: "connection closed" };
          return ok;
        },
        inspectSnap: async () => ({ name: "demo", version: "1.2", architecture: "amd64" }),
        review: async () => undefined,
        readback: async () => {
          if (read++ === 0) return [];
          throw new Error("readback unavailable");
        },
        recordPublication: async () => undefined,
        writeManifest: async () => undefined,
      },
    );
    await expect(operation).rejects.toBeInstanceOf(PartialPublicationError);
    await expect(operation).rejects.toThrow(/upload attempted.*readback failed/i);
  });

  test("rejects project symlinks before running external tools", async () => {
    const input = await recipe("name: demo\nbase: core24\nversion: '1.2'\nplatforms:\n  amd64:\n");
    await symlink("/etc/passwd", join(input.workspace, "nested", "outside"));
    let runs = 0;
    await expect(
      runRelease(
        {
          ...input,
          projectRoot: "nested",
          architecture: "amd64",
          channel: "latest/candidate",
          snapcraftChannel: "latest/stable",
          launchpadToken: "lp",
          storeToken: "store",
          sourceSha: "d".repeat(40),
        },
        {
          run: async () => {
            runs++;
            return ok;
          },
          inspectSnap: async () => ({ name: "demo", version: "1.2", architecture: "amd64" }),
          review: async () => undefined,
          readback: async () => [],
          recordPublication: async () => undefined,
          writeManifest: async () => undefined,
        },
      ),
    ).rejects.toThrow(/symlink/i);
    expect(runs).toBe(0);
  });

  test("keeps a fresh remote-build failure before Store reads and uploads", async () => {
    const input = await recipe("name: demo\nbase: core24\nversion: '1.2'\nplatforms:\n  amd64:\n");
    let reads = 0;
    let uploads = 0;
    await expect(
      runRelease(
        {
          ...input,
          projectRoot: "nested",
          architecture: "amd64",
          channel: "latest/candidate",
          snapcraftChannel: "latest/stable",
          launchpadToken: "lp",
          storeToken: "store",
          sourceSha: "9".repeat(40),
        },
        {
          run: async (spec) => {
            if (spec.args[0] === "remote-build") return { ...ok, exitCode: 5 };
            if (spec.args[0] === "upload") uploads++;
            return ok;
          },
          inspectSnap: async () => ({ name: "demo", version: "1.2", architecture: "amd64" }),
          review: async () => undefined,
          readback: async () => {
            reads++;
            return [];
          },
          recordPublication: async () => undefined,
          writeManifest: async () => undefined,
        },
      ),
    ).rejects.toThrow(/remote build.*5/i);
    expect({ reads, uploads }).toEqual({ reads: 0, uploads: 0 });
  });

  test("reports manifest failure after recording the exact publication", async () => {
    const input = await recipe("name: demo\nbase: core24\nversion: '1.2'\nplatforms:\n  amd64:\n");
    let read = 0;
    let recorded = "";
    const operation = runRelease(
      {
        ...input,
        projectRoot: "nested",
        architecture: "amd64",
        channel: "latest/candidate",
        snapcraftChannel: "latest/stable",
        launchpadToken: "lp",
        storeToken: "store",
        sourceSha: "8".repeat(40),
      },
      {
        run: async (spec) => {
          if (spec.args[0] === "remote-build")
            await writeFile(join(spec.cwd, "demo_1.2_amd64.snap"), "fresh snap");
          if (spec.args[0] === "upload")
            return { ...ok, stdout: "Revision 44 created for 'demo'\n" };
          return ok;
        },
        inspectSnap: async () => ({ name: "demo", version: "1.2", architecture: "amd64" }),
        review: async () => undefined,
        readback: async () =>
          read++
            ? [
                {
                  revision: "44",
                  architecture: "amd64",
                  version: "1.2",
                  digest: digest("fresh snap"),
                },
              ]
            : [],
        recordPublication: async ({ revision }) => {
          recorded = revision;
        },
        writeManifest: async () => {
          throw new Error("disk full");
        },
      },
    );
    await expect(operation).rejects.toBeInstanceOf(PartialPublicationError);
    await expect(operation).rejects.toThrow(/published revision 44.*manifest/i);
    expect(recorded).toBe("44");
  });

  test("reports tag push failure after publication and manifest stages", async () => {
    let calls = 0;
    const operation = recordReleaseTag(
      {
        cwd: process.cwd(),
        name: "demo",
        version: "1.0",
        revision: "44",
        architecture: "amd64",
        multiSnap: false,
        botName: "bot",
        botEmail: "bot@example.invalid",
      },
      async () => (++calls === 1 ? ok : { ...ok, exitCode: 9 }),
    );
    await expect(operation).rejects.toBeInstanceOf(PartialPublicationError);
    await expect(operation).rejects.toThrow(/published revision 44.*tagging/i);
  });
});
