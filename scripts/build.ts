import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { actions } from "./actions.js";

const sourceRoot = process.cwd();

export async function buildAll(outputRoot = sourceRoot): Promise<void> {
  for (const action of actions) {
    const destination = resolve(outputRoot, action, "dist");
    await rm(destination, { recursive: true, force: true });
    await mkdir(destination, { recursive: true });
    const result = await build({
      absWorkingDir: sourceRoot,
      entryPoints: [resolve(sourceRoot, action, "main.ts")],
      outfile: resolve(destination, "index.cjs"),
      bundle: true,
      format: "cjs",
      platform: "node",
      target: "node24",
      legalComments: "none",
      metafile: true,
      sourcemap: false,
      minify: false,
      logLevel: "warning",
    });
    const bundlePath = resolve(destination, "index.cjs");
    await writeFile(bundlePath, normalizeGenerated(await readFile(bundlePath, "utf8")), {
      mode: 0o644,
    });
    await writeFile(
      resolve(destination, "licenses.txt"),
      await bundledLicenses(Object.keys(result.metafile.inputs)),
      { mode: 0o644 },
    );
  }
}

async function bundledLicenses(inputs: readonly string[]): Promise<string> {
  const packages = new Set<string>();
  for (const input of inputs) {
    const marker = "node_modules/";
    const offset = input.lastIndexOf(marker);
    if (offset < 0) continue;
    const parts = input.slice(offset + marker.length).split("/");
    packages.add(parts[0]!.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0]!);
  }
  const sections = [
    `Snapcrafters CI\n\n${await readFile(resolve(sourceRoot, "LICENSE"), "utf8")}`,
  ];
  for (const name of [...packages].sort()) {
    const root = resolve(sourceRoot, "node_modules", name);
    const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
      version?: string;
    };
    const license = (await readdir(root)).find((file) => /^licen[cs]e(?:\..+)?$/i.test(file));
    if (!license) throw new Error(`Bundled dependency ${name} has no licence file`);
    sections.push(
      `${name}@${metadata.version ?? "unknown"}\n\n${await readFile(join(root, license), "utf8")}`,
    );
  }
  const separator = `\n\n${"-".repeat(79)}\n\n`;
  return normalizeGenerated(sections.join(separator));
}

function normalizeGenerated(source: string): string {
  return `${source.replaceAll(/[^\S\r\n]+$/gm, "").trimEnd()}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(sourceRoot, "scripts/build.ts")) {
  await buildAll(process.argv[2] ? resolve(process.argv[2]) : sourceRoot);
}
