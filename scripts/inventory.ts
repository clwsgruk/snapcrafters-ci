import { execFile as execFileCallback } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { parse } from "yaml";

const execFile = promisify(execFileCallback);
const fixtureRoot = resolve("test/fixtures/inventory");
const recipeRoot = resolve(fixtureRoot, "recipes");

async function gh(path: string, ...args: string[]): Promise<string> {
  const result = await execFile("gh", ["api", path, ...args], {
    maxBuffer: 64 * 1024 * 1024,
    env: process.env,
  });
  return result.stdout;
}

const pages = JSON.parse(
  await gh("orgs/snapcrafters/repos?per_page=100&type=public", "--paginate", "--slurp"),
) as Array<
  Array<{ full_name: string; default_branch: string; archived: boolean; disabled: boolean }>
>;
const repositories = pages
  .flat()
  .filter((repo) => !repo.archived && !repo.disabled)
  .sort((a, b) => a.full_name.localeCompare(b.full_name));
if (repositories.length !== 87) {
  throw new Error(
    `Expected 87 active repositories on 2026-09-06, received ${repositories.length}`,
  );
}

await rm(recipeRoot, { recursive: true, force: true });
await mkdir(recipeRoot, { recursive: true });
const inventoryRepositories: Array<{ repository: string; branch: string; commit: string }> = [];
interface RecipeInventory {
  repository: string;
  commit: string;
  path: string;
  blob: string;
  fixture: string;
  name: unknown;
  base: unknown;
  version: unknown;
  adoptInfo: unknown;
  architectures: unknown;
  platforms: unknown;
}
const recipes: RecipeInventory[] = [];

for (let offset = 0; offset < repositories.length; offset += 8) {
  await Promise.all(
    repositories.slice(offset, offset + 8).map(async (repository) => {
      const ref = JSON.parse(
        await gh(`repos/${repository.full_name}/git/ref/heads/${repository.default_branch}`),
      ) as { object: { sha: string } };
      const commit = ref.object.sha;
      const tree = JSON.parse(
        await gh(`repos/${repository.full_name}/git/trees/${commit}?recursive=1`),
      ) as { truncated: boolean; tree: Array<{ path: string; type: string; sha: string }> };
      if (tree.truncated)
        throw new Error(`Recursive tree was truncated for ${repository.full_name}`);
      inventoryRepositories.push({
        repository: repository.full_name,
        branch: repository.default_branch,
        commit,
      });
      for (const entry of tree.tree) {
        if (entry.type !== "blob" || !/(^|\/)snapcraft\.ya?ml$/.test(entry.path)) continue;
        const blob = JSON.parse(
          await gh(`repos/${repository.full_name}/git/blobs/${entry.sha}`),
        ) as { encoding: string; content: string; size: number };
        if (blob.encoding !== "base64" || blob.size > 2 * 1024 * 1024) {
          throw new Error(`Unsupported recipe blob for ${repository.full_name}:${entry.path}`);
        }
        const source = Buffer.from(blob.content.replaceAll("\n", ""), "base64");
        const data = parse(source.toString("utf8"), { uniqueKeys: true }) as Record<
          string,
          unknown
        >;
        const fixture = `${repository.full_name.split("/")[1]}--${entry.path.replaceAll(/[^A-Za-z0-9.-]/g, "__")}`;
        await writeFile(resolve(recipeRoot, fixture), source);
        recipes.push({
          repository: repository.full_name,
          commit,
          path: entry.path,
          blob: entry.sha,
          fixture,
          name: data?.name ?? null,
          base: data?.base ?? null,
          version: data?.version ?? null,
          adoptInfo: data?.["adopt-info"] ?? null,
          architectures: data?.architectures ?? null,
          platforms: data?.platforms ?? null,
        });
      }
    }),
  );
}

inventoryRepositories.sort((a, b) => a.repository.localeCompare(b.repository));
recipes.sort((a, b) => `${a.repository}:${a.path}`.localeCompare(`${b.repository}:${b.path}`));
await writeFile(
  resolve(fixtureRoot, "active-recipes.json"),
  `${JSON.stringify(
    {
      capturedAt: "2026-09-06",
      selection: "Every non-archived, non-disabled public repository in snapcrafters",
      repositories: inventoryRepositories,
      recipes,
    },
    null,
    2,
  )}\n`,
);
console.log(`Captured ${inventoryRepositories.length} repositories and ${recipes.length} recipes`);
