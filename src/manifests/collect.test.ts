import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { collectManifests, type ManifestGitHub } from "./collect.js";

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries: Array<{ name: string; contents: string; mode?: number }>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.contents);
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(0x031e, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(((entry.mode ?? 0o100600) * 0x10000) >>> 0, 38);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function api(
  pages: Array<Array<{ id: number; name: string; expired: boolean }>>,
  archives: Map<number, Buffer>,
): ManifestGitHub {
  return {
    listArtifacts: async (page) => ({
      artifacts: pages[page - 1] ?? [],
      hasNext: page < pages.length,
    }),
    downloadArtifact: async (id) => archives.get(id)!,
  };
}

const amd64 = "name: demo\narchitecture: amd64\nrevision: 10\n";
const arm64 = "name: demo\narchitecture: arm64\nrevision: 11\n";

describe("manifest collection", () => {
  test("paginates and binds the complete expected snap/architecture set", async () => {
    const destination = await mkdtemp(join(tmpdir(), "manifests-"));
    const manifests = await collectManifests(
      api(
        [
          [{ id: 1, name: "manifest-amd64", expired: false }],
          [{ id: 2, name: "manifest-arm64", expired: false }],
        ],
        new Map([
          [1, zip([{ name: "manifest-amd64.yaml", contents: amd64 }])],
          [2, zip([{ name: "manifest-arm64.yaml", contents: arm64 }])],
        ]),
      ),
      destination,
      { snap: "demo", architectures: ["amd64", "arm64"] },
    );
    expect(manifests.map(({ architecture, revision }) => [architecture, revision])).toEqual([
      ["amd64", "10"],
      ["arm64", "11"],
    ]);
  });

  test.each([
    ["wrong snap", "name: other\narchitecture: amd64\nrevision: 10\n", /snap/i],
    ["duplicate revision record", amd64, /duplicate/i],
  ])("rejects %s before writing any destination", async (kind, second, error) => {
    const destination = await mkdtemp(join(tmpdir(), "manifests-"));
    const entries =
      kind === "duplicate revision record"
        ? [
            { name: "manifest-amd64.yaml", contents: amd64 },
            { name: "manifest-amd64.yml", contents: second },
          ]
        : [{ name: "manifest-amd64.yaml", contents: second }];
    await expect(
      collectManifests(
        api([[{ id: 1, name: "manifest-amd64", expired: false }]], new Map([[1, zip(entries)]])),
        destination,
        { snap: "demo", architectures: ["amd64"] },
      ),
    ).rejects.toThrow(error);
    expect(await readdir(destination)).toEqual([]);
  });

  test("rejects missing expected architectures and expired artifacts", async () => {
    const destination = await mkdtemp(join(tmpdir(), "manifests-"));
    await expect(
      collectManifests(
        api(
          [[{ id: 1, name: "manifest-amd64", expired: false }]],
          new Map([[1, zip([{ name: "manifest-amd64.yaml", contents: amd64 }])]]),
        ),
        destination,
        { snap: "demo", architectures: ["amd64", "arm64"] },
      ),
    ).rejects.toThrow(/missing.*arm64/i);
    expect(await readdir(destination)).toEqual([]);
    await expect(
      collectManifests(
        api([[{ id: 2, name: "manifest-arm64", expired: true }]], new Map()),
        destination,
        { snap: "demo", architectures: ["arm64"] },
      ),
    ).rejects.toThrow(/expired/i);
  });

  test.each([
    ["traversal", "../manifest-amd64.yaml", 0o100600],
    ["absolute", "/manifest-amd64.yaml", 0o100600],
    ["symlink", "manifest-amd64.yaml", 0o120777],
  ])("rejects %s archive entries", async (_kind, name, mode) => {
    const destination = await mkdtemp(join(tmpdir(), "manifests-"));
    await expect(
      collectManifests(
        api(
          [[{ id: 1, name: "manifest-amd64", expired: false }]],
          new Map([[1, zip([{ name, contents: amd64, mode }])]]),
        ),
        destination,
        { snap: "demo", architectures: ["amd64"] },
      ),
    ).rejects.toThrow();
    expect(await readdir(destination)).toEqual([]);
  });
});
