import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
export function measure(texts: string[], lines: number, files: number) {
  const count = texts.reduce((n, s) => n + s.split(/\r?\n/).filter((l) => l.trim()).length, 0);
  if (count > lines) throw Error(`line cap exceeded: ${count} > ${lines}`);
  if (texts.length > files) throw Error(`file cap exceeded: ${texts.length} > ${files}`);
  return { lines: count, files: texts.length };
}
export function productionSources(paths: string[]) {
  const source = paths.filter((path) => path.startsWith("src/"));
  const unsupported = source.filter((path) => !path.endsWith(".ts"));
  if (unsupported.length) throw Error(`Unsupported production source: ${unsupported.join(", ")}`);
  return source;
}
if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const paths = readdirSync(".", { recursive: true })
    .map(String)
    .filter(
      (p) => !p.startsWith("node_modules/") && !p.startsWith(".git/") && !p.includes("/dist/"),
    );
  const source = productionSources(paths.filter((p) => !p.endsWith("/")));
  const adapters = paths.filter((p) => /^[^/]+\/main\.ts$/.test(p));
  const sourceFiles = paths.filter((p) => p.startsWith("src/") && statSync(p).isFile());
  if (sourceFiles.length > 15 || adapters.length !== 12)
    throw Error(
      `Expected <=15 source files and 12 adapters; found ${sourceFiles.length}, ${adapters.length}`,
    );
  const categories: [string, string[], number, number][] = [
    ["production", [...source, ...adapters], 2500, 27],
    ["tooling", paths.filter((p) => /^scripts\/.*\.[cm]?[jt]s$/.test(p)), 400, Infinity],
    ["tests", paths.filter((p) => /^test\/.*\.ts$/.test(p)), 2500, Infinity],
    [
      "fixtures",
      paths.filter((p) => p.startsWith("test/fixtures/") && /\.[^/]+$/.test(p)),
      1500,
      Infinity,
    ],
  ];
  for (const [name, files, limit, cap] of categories)
    console.log(
      name,
      measure(
        files.map((p) => readFileSync(p, "utf8")),
        limit,
        cap,
      ),
    );
}
