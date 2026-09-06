import { expect, test } from "vitest";
import { crc32 } from "node:zlib";
import { unpack } from "../src/manifests.ts";
export function zip(entries: [string, string, number?][]) {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const [name, text, mode = 0o100600] of entries) {
    const path = Buffer.from(name),
      data = Buffer.from(text),
      head = Buffer.alloc(30),
      index = Buffer.alloc(46);
    head.writeUInt32LE(0x04034b50);
    head.writeUInt16LE(20, 4);
    head.writeUInt32LE(crc32(data), 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(path.length, 26);
    index.writeUInt32LE(0x02014b50);
    index.writeUInt16LE(0x0314, 4);
    index.writeUInt16LE(20, 6);
    index.writeUInt32LE(crc32(data), 16);
    index.writeUInt32LE(data.length, 20);
    index.writeUInt32LE(data.length, 24);
    index.writeUInt16LE(path.length, 28);
    index.writeUInt32LE((mode * 65536) >>> 0, 38);
    index.writeUInt32LE(offset, 42);
    local.push(head, path, data);
    central.push(index, path);
    offset += head.length + path.length + data.length;
  }
  const end = Buffer.alloc(22),
    index = Buffer.concat(central);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(index.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, index, end]);
}
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
  const { mkdtempSync, readdirSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  let gets = 0;
  const server = createServer((req, res) => {
    expect(req.headers.authorization).toBe("Bearer artifact-token");
    if (req.url === "/repos/owner/repo/actions/runs/1/artifacts?per_page=100&page=1") {
      gets++;
      res.end(JSON.stringify({ artifacts: [{ id: 1, name: "manifest-amd64", expired: false }] }));
    } else if (req.url === "/repos/owner/repo/actions/artifacts/1/zip") {
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
    expect(gets).toBe(2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true });
  }
});
