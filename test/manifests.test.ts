import { expect, test } from "vitest";

import { unpack } from "../src/manifests.ts";
import { zip } from "./zip.ts";

test("manifest ZIP binds label, filename, snap and exact decimal revision before extraction", async () => {
  const text = "name: sample\narchitecture: amd64\nrevision: 9007199254740993\n";
  expect(await unpack(zip([["manifest-amd64.yaml", text]]), "manifest-amd64", "sample")).toEqual({
    name: "sample",
    architecture: "amd64",
    revision: "9007199254740993",
  });
  for (const [name, body, mode] of [
    ["../manifest-amd64.yaml", text],
    ["/manifest-amd64.yaml", text],
    ["manifest-arm64.yaml", text],
    ["manifest-amd64.yaml", text, 0o120777],
    ["manifest-amd64.yaml", text.replace("sample", "other")],
    ["manifest-amd64.yaml", text.replace("9007199254740993", "1.2")],
  ] as [string, string, number?][])
    await expect(unpack(zip([[name, body, mode]]), "manifest-amd64", "sample")).rejects.toThrow();
  await expect(
    unpack(
      zip([
        ["manifest-amd64.yaml", text],
        ["manifest-amd64.yaml", text],
      ]),
      "manifest-amd64",
      "sample",
    ),
  ).rejects.toThrow();
});

test("artifact collection paginates and validates the complete expected set before filesystem writes", async () => {
  const { fetchManifests } = await import("../src/manifests.ts");
  const { createServer } = await import("node:http");
  const { mkdtempSync, readdirSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  let gets = 0;
  const server = createServer((req, res) => {
    expect(req.headers.authorization).toBe("Bearer artifact-token");
    if (req.url === "/repos/owner/repo/actions/runs/1/artifacts?per_page=100&page=1") {
      gets++;
      res.end(
        JSON.stringify({
          artifacts: Array.from({ length: 100 }, (_, i) => ({
            id: i + 1,
            name: `log-${i}`,
            expired: false,
          })),
        }),
      );
    } else if (req.url === "/repos/owner/repo/actions/runs/1/artifacts?per_page=100&page=2") {
      gets++;
      res.end(JSON.stringify({ artifacts: [{ id: 501, name: "manifest-amd64", expired: false }] }));
    } else if (req.url === "/repos/owner/repo/actions/artifacts/501/zip") {
      res.end(
        zip([["manifest-amd64.yaml", "name: sample\narchitecture: amd64\nrevision: '10'\n"]]),
      );
    } else {
      res.writeHead(403);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    dir = mkdtempSync(path.join(tmpdir(), "artifacts-"));
  try {
    await expect(
      fetchManifests(
        "artifact-token",
        "owner/repo",
        "1",
        dir,
        { snap: "sample", architectures: ["amd64", "arm64"] },
        base,
      ),
    ).rejects.toThrow(/set mismatch/);
    expect(readdirSync(dir)).toEqual([]);
    expect(
      await fetchManifests(
        "artifact-token",
        "owner/repo",
        "1",
        dir,
        { snap: "sample", architectures: ["amd64"] },
        base,
      ),
    ).toHaveLength(1);
    expect(readdirSync(dir)).toEqual(["manifest-amd64.yaml"]);
    expect(gets).toBe(4);
    writeFileSync(
      path.join(dir, "manifest-arm64.yaml"),
      "name: sample\narchitecture: arm64\nrevision: '99'\n",
    );
    await expect(
      fetchManifests(
        "artifact-token",
        "owner/repo",
        "1",
        dir,
        { snap: "sample", architectures: ["amd64"] },
        base,
      ),
    ).rejects.toThrow(/stale/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true });
  }
});
