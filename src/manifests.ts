import { fromBuffer } from "yauzl";
import { crc32 } from "node:zlib";
import { readFileSync, readdirSync, writeFileSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import { architecture, yaml, scalar } from "./project.ts";
import { api, bounded, pages } from "./github.ts";
export interface Manifest {
  name: string;
  architecture: string;
  revision: string;
}
export function revision(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "bigint")
    throw Error("Revision must be an exact positive decimal string");
  const text = String(value);
  if (!/^[1-9][0-9]{0,39}$/.test(text)) throw Error("Invalid revision");
  return text;
}
export function manifest(source: string, label: string, snap?: string): Manifest {
  const data = yaml(source),
    name = scalar(data.name),
    arch = architecture(data.architecture);
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) ||
    name.length > 40 ||
    label !== `manifest-${arch}` ||
    (snap && snap !== name)
  )
    throw Error("Manifest identity mismatch");
  return { name, architecture: arch, revision: revision(data.revision) };
}
export async function unpack(bytes: Buffer, label: string, snap?: string): Promise<Manifest> {
  if (bytes.length > 1024 * 1024) throw Error("Archive size limit");
  return new Promise((resolve, reject) =>
    fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) {
        reject(error);
        return;
      }
      const fail = (reason: unknown) => {
        zip.close();
        reject(reason);
      };
      let result: Manifest | undefined;
      zip.on("error", fail);
      zip.on("entry", (entry) => {
        if (
          result ||
          entry.fileName !== `${label}.yaml` ||
          !/^manifest-[a-z0-9]+\.yaml$/.test(entry.fileName) ||
          ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000 ||
          entry.uncompressedSize > 65536
        ) {
          fail(Error("Unsafe or duplicate manifest entry"));
          return;
        }
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) {
            fail(error);
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          stream.on("error", fail);
          stream.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > 65536) {
              stream.destroy();
              fail(Error("Decompression limit"));
            } else chunks.push(chunk);
          });
          stream.on("end", () => {
            try {
              const data = Buffer.concat(chunks);
              if (crc32(data) !== entry.crc32) throw Error("ZIP checksum mismatch");
              result = manifest(data.toString("utf8"), label, snap);
              zip.readEntry();
            } catch (error) {
              fail(error);
            }
          });
        });
      });
      zip.on("end", () => {
        zip.close();
        if (!result) reject(Error("Empty archive"));
        else resolve(result);
      });
      zip.readEntry();
    }),
  );
}
export async function fetchManifests(
  token: string,
  repository: string,
  run: string,
  directory = process.cwd(),
  expected?: { snap: string; architectures: string[] },
  base = api,
) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[1-9]\d*$/.test(run))
    throw Error("Invalid repository/run");
  const artifacts = await pages<{ id: number; name: string; expired: boolean }>(
    `/repos/${repository}/actions/runs/${run}/artifacts`,
    token,
    "artifacts",
    base,
  );
  const manifests: Manifest[] = [],
    names = new Set<string>();
  for (const artifact of artifacts.filter((a) => a.name.startsWith("manifest-"))) {
    if (artifact.expired || names.has(artifact.name) || !Number.isSafeInteger(artifact.id))
      throw Error("Expired or duplicate artifact");
    names.add(artifact.name);
    const response = await fetch(
      `${base}/repos/${repository}/actions/artifacts/${artifact.id}/zip`,
      {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
      },
    );
    let download = response;
    if (response.status === 302) {
      const location = new URL(response.headers.get("location") || "");
      if (location.protocol !== "https:") throw Error("Unsafe artifact redirect");
      download = await fetch(location, { redirect: "error", signal: AbortSignal.timeout(20000) });
    }
    if (!download.ok) throw Error(`Artifact download failed (${download.status})`);
    manifests.push(
      await unpack(await bounded(download, 1024 * 1024), artifact.name, expected?.snap),
    );
  }
  if (new Set(manifests.map((m) => m.name)).size > 1) throw Error("Multiple snaps in manifest set");
  if (
    expected &&
    manifests.length &&
    JSON.stringify(manifests.map((m) => m.architecture).sort()) !==
      JSON.stringify([...expected.architectures].sort())
  )
    throw Error("Manifest architecture set mismatch");
  for (const m of manifests) {
    const file = resolve(directory, `manifest-${m.architecture}.yaml`);
    try {
      const stat = lstatSync(file);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        JSON.stringify(
          manifest(readFileSync(file, "utf8"), `manifest-${m.architecture}`, m.name),
        ) !== JSON.stringify(m)
      )
        throw Error("Existing manifest differs");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  for (const m of manifests)
    writeFileSync(
      resolve(directory, `manifest-${m.architecture}.yaml`),
      `name: ${m.name}\narchitecture: ${m.architecture}\nrevision: '${m.revision}'\n`,
      { mode: 0o600 },
    );
  return manifests;
}
export function localManifests(directory: string, snap: string): Manifest[] {
  return readdirSync(directory)
    .filter((p) => /^manifest-.*\.yaml$/.test(p))
    .map((p) => {
      const file = resolve(directory, p);
      if (!lstatSync(file).isFile()) throw Error("Unsafe manifest file");
      return manifest(readFileSync(file, "utf8"), p.slice(0, -5), snap);
    });
}
