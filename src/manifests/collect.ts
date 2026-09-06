import { lstat, mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import { decodeManifest, validateArchiveEntry, type Manifest } from "./codec.js";
import { InputError } from "../runtime/errors.js";

export interface Artifact {
  id: number;
  name: string;
  expired: boolean;
}

export interface ManifestGitHub {
  listArtifacts(page: number): Promise<{ artifacts: Artifact[]; hasNext: boolean }>;
  downloadArtifact(id: number): Promise<Buffer>;
}

export interface ExpectedManifests {
  snap: string;
  architectures: readonly Manifest["architecture"][];
}

export async function collectManifests(
  api: ManifestGitHub,
  destination: string,
  expected?: ExpectedManifests,
): Promise<Manifest[]> {
  await mkdir(destination, { recursive: true });
  const artifacts: Artifact[] = [];
  for (let page = 1; ; page++) {
    const result = await api.listArtifacts(page);
    artifacts.push(...result.artifacts.filter((item) => item.name.startsWith("manifest-")));
    if (!result.hasNext) break;
    if (page >= 100) throw new InputError("Artifact pagination limit exceeded");
  }
  const destinations = new Set<string>();
  const manifests: Manifest[] = [];
  const files: Array<{ filename: string; text: string }> = [];
  let archiveBytes = 0;
  for (const artifact of artifacts) {
    if (artifact.expired) throw new InputError(`Manifest artifact ${artifact.name} is expired`);
    const archive = await api.downloadArtifact(artifact.id);
    archiveBytes += archive.length;
    if (archive.length > 5 * 1024 * 1024)
      throw new InputError("Manifest archive exceeds size limit");
    if (archiveBytes > 25 * 1024 * 1024)
      throw new InputError("Combined manifest archives exceed size limit");
    for (const entry of await unzipEntries(archive)) {
      validateArchiveEntry(entry.name, entry.data.length, 64 * 1024);
      const filename = basename(entry.name);
      if (destinations.has(filename))
        throw new InputError(`Duplicate manifest destination: ${filename}`);
      destinations.add(filename);
      const text = entry.data.toString("utf8");
      const manifest = decodeManifest(text, filename);
      if (expected && manifest.name !== expected.snap)
        throw new InputError(`Manifest snap ${manifest.name} does not match ${expected.snap}`);
      if (manifests.some((item) => item.architecture === manifest.architecture))
        throw new InputError(`Duplicate manifest architecture: ${manifest.architecture}`);
      manifests.push(manifest);
      files.push({ filename, text });
    }
  }
  if (expected) {
    const unexpected = manifests.filter(
      (item) => !expected.architectures.includes(item.architecture),
    );
    if (unexpected.length)
      throw new InputError(`Unexpected manifest architecture: ${unexpected[0]!.architecture}`);
    const missing = expected.architectures.filter(
      (architecture) => !manifests.some((item) => item.architecture === architecture),
    );
    if (missing.length)
      throw new InputError(`Missing expected manifest architectures: ${missing.join(", ")}`);
  }
  for (const { filename } of files) {
    try {
      await lstat(join(destination, filename));
      throw new InputError(`Duplicate manifest destination: ${filename}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  for (const { filename, text } of files)
    await writeFile(join(destination, filename), text, { flag: "wx", mode: 0o600 });
  return manifests;
}

function unzipEntries(archive: Buffer): Promise<Array<{ name: string; data: Buffer }>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(archive, { lazyEntries: true, decodeStrings: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new InputError("Invalid ZIP archive"));
      readZip(zip).then(resolve, reject);
    });
  });
}

async function readZip(zip: ZipFile): Promise<Array<{ name: string; data: Buffer }>> {
  const result: Array<{ name: string; data: Buffer }> = [];
  let totalSize = 0;
  return await new Promise((resolve, reject) => {
    zip.on("error", reject);
    zip.on("end", () => resolve(result));
    zip.on("entry", (entry: Entry) => {
      if (result.length >= 100) return reject(new InputError("Archive entry limit exceeded"));
      const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (mode === 0o120000)
        return reject(new InputError("Symlink archive entries are forbidden"));
      if (entry.fileName.endsWith("/"))
        return reject(new InputError("Archive directories are forbidden"));
      validateArchiveEntry(entry.fileName, entry.uncompressedSize, 64 * 1024);
      totalSize += entry.uncompressedSize;
      if (totalSize > 1024 * 1024)
        return reject(new InputError("Archive decompression limit exceeded"));
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) return reject(error ?? new Error("Cannot read ZIP entry"));
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 64 * 1024) stream.destroy(new InputError("Decompression limit exceeded"));
          else chunks.push(chunk);
        });
        stream.on("error", reject);
        stream.on("end", () => {
          result.push({ name: entry.fileName, data: Buffer.concat(chunks) });
          zip.readEntry();
        });
      });
    });
    zip.readEntry();
  });
}
