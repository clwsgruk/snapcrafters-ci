import type { Manifest } from "../manifests/codec.js";
import type { Architecture } from "../project/types.js";
import { InputError } from "../runtime/errors.js";

export interface TestingIssueInput {
  ciRepo: string;
  snap: string;
  version?: string;
  channel: string;
  promotionChannel: string;
  architectures: Architecture[];
  manifests: Manifest[];
  instructions: string;
  deliveryMarker: string;
}

const bodyTemplate = `A new version ({{ version }}) of \`{{ snap }}\` was just pushed to the \`{{ channel }}\` channel [in the snap store](https://snapcraft.io/{{ snap }}). The following revisions are available.

{{ table }}

## Automated testing

If configured, the snap will be installed in a VM, and any test results or screenshots will be posted to this issue as a comment shortly.

## How to test it manually

{{ instructions }}

## How to release it

Maintainers can promote this to stable by commenting \`/promote <rev>[,<rev>] {{ promotionChannel }} [done]\`.

> For example
>
> - To promote a single revision, run \`/promote <rev> {{ promotionChannel }}\`
> - To promote multiple revisions, run \`/promote <rev>,<rev> {{ promotionChannel }}\`
> - To promote a revision and close the issue, run \`/promote <rev>,<rev> {{ promotionChannel }} done\`

You can promote all revisions that were just built with:

\`\`\`
/promote {{ revisions }} {{ promotionChannel }} done
\`\`\``;

export async function createTestingIssue(
  input: TestingIssueInput,
  deps: {
    lookup(
      snap: string,
      architecture: Architecture,
      channel: string,
    ): Promise<{ revision: string; version: string } | undefined>;
    createIssue(title: string, body: string, labels: string[]): Promise<number>;
  },
): Promise<number> {
  if (!/^<!-- snapcrafters-ci:issue:[1-9][0-9]*:[0-9a-f]{40} -->$/.test(input.deliveryMarker))
    throw new InputError("Invalid testing issue delivery marker");
  if (input.ciRepo !== "snapcrafters/ci") {
    throw new InputError(
      "ci-repo overrides are deprecated; test forks by pinning the fork action at an immutable SHA",
    );
  }
  const revisions = new Map<Architecture, string>();
  const observedVersions = new Set<string>();
  if (input.manifests.length) {
    for (const manifest of input.manifests) {
      if (manifest.name !== input.snap)
        throw new InputError("Manifest snap does not match project snap");
      if (revisions.has(manifest.architecture))
        throw new InputError(`Duplicate manifest for ${manifest.architecture}`);
      revisions.set(manifest.architecture, manifest.revision);
      if (manifest.version) observedVersions.add(manifest.version);
    }
  } else {
    for (const architecture of input.architectures) {
      const found = await deps.lookup(input.snap, architecture, input.channel);
      if (found) {
        revisions.set(architecture, found.revision);
        observedVersions.add(found.version);
      }
    }
  }
  for (const architecture of input.architectures) {
    if (!revisions.has(architecture))
      throw new InputError(`Missing revision for expected architecture ${architecture}`);
  }
  if (revisions.size !== input.architectures.length)
    throw new InputError("Manifest includes an unexpected architecture");
  if (input.version) observedVersions.add(input.version);
  if (observedVersions.size !== 1)
    throw new InputError("Testing issue requires one exact published version");
  const version = [...observedVersions][0]!;
  const table = `<table><thead><tr><th>CPU Architecture</th><th>Revision</th></tr></thead><tbody>${input.architectures.map((arch) => `<tr><td>${arch}</td><td>${revisions.get(arch)}</td></tr>`).join("")}</tbody></table>`;
  const values: Record<string, string> = {
    snap: input.snap,
    version,
    channel: input.channel,
    promotionChannel: input.promotionChannel,
    table,
    instructions: renderLegacyPlaceholders(input.instructions, input),
    revisions: input.architectures.map((arch) => revisions.get(arch)).join(","),
  };
  const body = `${bodyTemplate.replaceAll(/\{\{ ([A-Za-z]+) \}\}/g, (_, key: string) => values[key]!)}\n\n${input.deliveryMarker}`;
  const title = `Call for testing \`${input.snap}\` on channel \`${input.channel}\``;
  return deps.createIssue(title, body, ["testing"]);
}

function renderLegacyPlaceholders(value: string, input: TestingIssueInput): string {
  return value
    .replaceAll("{{ env.snap_name }}", input.snap)
    .replaceAll("{{ env.channel }}", input.channel)
    .replaceAll("{{ env.promotion_channel }}", input.promotionChannel);
}
