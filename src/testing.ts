import { command, script, safeEnv } from "./execution.ts";
import { marked, marker } from "./github.ts";
import { revision, fetchManifests, type Manifest } from "./manifests.ts";
import { architecture, project } from "./project.ts";
import { input, outputs } from "./runtime.ts";
import { channel, repository, snapName, revisions } from "./validation.ts";

export interface Testing {
  repository: string;
  snap: string;
  channel: string;
  destination: string;
  version: string;
  rows: Manifest[];
}

const table = (rows: Manifest[]) => {
  const body = rows
    .map((row) => `<tr><td>${row.architecture}</td><td>${row.revision}</td></tr>`)
    .join("");

  return `<table><thead><tr><th>CPU Architecture</th><th>Revision</th></tr></thead><tbody>${body}</tbody></table>`;
};

export function testingBody(context: Testing, instructions: string) {
  const fields: Record<string, string> = {
    snap_name: context.snap,
    channel: context.channel,
    version: context.version,
    promotion_channel: context.destination,
  };

  return (
    `A new version (${context.version}) of \`${context.snap}\` was just pushed to the \`${context.channel}\` channel [in the snap store](https://snapcraft.io/${context.snap}). The following revisions are available.\n\n${table(context.rows)}` +
    "\n\n## Automated testing\n\nAutomated results and screenshots will be posted below when configured." +
    `\n\n## How to test it manually\n\n${instructions.replace(/{{\s*env\.(\w+)\s*}}/g, (match, key: string) => fields[key] ?? match)}` +
    "\n\n## How to release it\n\nMaintainers can promote these revisions with:" +
    `\n\n\`\`\`\n/promote ${[...new Set(context.rows.map((r) => r.revision))].join(",")} ${context.destination} done\n\`\`\`` +
    `\n<!-- snapcrafters-testing:${JSON.stringify(context)} -->`
  );
}

export function testingIssue(
  body: string,
  repo: string,
  snap: string,
  destination: string,
): Testing {
  if (body.length > 100000) {
    throw Error("Testing issue too large");
  }

  const embedded = [...body.matchAll(/<!-- snapcrafters-testing:(.+) -->/g)];
  if (embedded.length > 1) {
    throw Error("Ambiguous testing context");
  }

  let data: Testing;
  if (embedded.length) {
    data = JSON.parse(embedded[0][1]) as Testing;
  } else {
    const intro = body.match(
      /A new version \(([^\n]+)\) of `([a-z0-9-]+)` was just pushed to the `([^`]+)` channel/,
    );
    const target = body.match(/^\/promote ([1-9][0-9,]*) ([\w./+-]+) done$/m);
    if (!intro || !target) {
      throw Error("Unrecognized legacy testing issue");
    }
    data = {
      repository: repo,
      snap: intro[2],
      version: intro[1],
      channel: intro[3],
      destination: target[2],
      rows: [...body.matchAll(/<tr><td>([a-z0-9]+)<\/td><td>([1-9][0-9]*)<\/td><\/tr>/g)].map(
        (m) => ({
          name: intro[2],
          architecture: m[1],
          revision: m[2],
        }),
      ),
    };
    if (target[1] !== data.rows.map((r) => r.revision).join(",")) {
      throw Error("Legacy revision set mismatch");
    }
  }

  if (
    repository(data.repository) !== repo ||
    snapName(data.snap) !== snap ||
    channel(data.destination) !== destination ||
    typeof data.version !== "string"
  ) {
    throw Error("Testing issue identity mismatch");
  }
  channel(data.channel);
  if (
    !body
      .trimStart()
      .startsWith(
        `A new version (${data.version}) of \`${data.snap}\` was just pushed to the \`${data.channel}\` channel`,
      )
  ) {
    throw Error("Testing prose differs from bound context");
  }
  if (
    !Array.isArray(data.rows) ||
    !data.rows.length ||
    data.rows.length > 7 ||
    new Set(data.rows.map((r) => r.architecture)).size !== data.rows.length
  ) {
    throw Error("Invalid testing table");
  }

  for (const row of data.rows) {
    architecture(row.architecture);
    revision(row.revision);
    if (row.name !== snap) {
      throw Error("Testing table snap mismatch");
    }
  }
  if (!body.includes(table(data.rows))) {
    throw Error("Testing table differs from bound context");
  }

  return data;
}

export async function callForTesting() {
  if (input("ci-repo") !== "snapcrafters/ci") {
    throw Error("ci-repo overrides are deprecated; pin a forked action SHA");
  }

  const p = project(input("snapcraft-project-root"));
  const snap = snapName(p.outputs["snap-name"]);
  const repo = repository(process.env.GITHUB_REPOSITORY!);
  const token = input("github-token");
  const destination = channel(input("promotion-channel"));
  const candidate = channel(input("channel"));
  const arches = [...new Set(input("architectures").trim().split(/\s+/).map(architecture))];

  let rows = await fetchManifests(token, repo, process.env.GITHUB_RUN_ID!, process.cwd(), {
    snap,
    architectures: arches,
  });
  if (!rows.length) {
    rows = arches.map((arch) => {
      const matches = revisions(
        command("snapcraft", ["revisions", snap, "--arch", arch], process.cwd(), {
          ...safeEnv(),
          SNAPCRAFT_STORE_CREDENTIALS: input("store-token"),
        }),
      ).filter((r) => r.architectures.includes(arch) && r.channels.includes(`${candidate}*`));
      if (matches.length !== 1) {
        throw Error(`No exact active revision for ${arch}`);
      }
      return { name: snap, architecture: arch, revision: matches[0].revision };
    });
  }

  let version = p.outputs.version;
  if (p.data.version == null) {
    const versions = rows.map((row) => {
      const matches = revisions(
        command("snapcraft", ["revisions", snap, "--arch", row.architecture], process.cwd(), {
          ...safeEnv(),
          SNAPCRAFT_STORE_CREDENTIALS: input("store-token"),
        }),
      ).filter(
        (r) =>
          r.revision === row.revision &&
          r.architectures.includes(row.architecture) &&
          r.channels.includes(`${candidate}*`),
      );
      if (matches.length !== 1) {
        throw Error("Adopted version requires exact active Store revision");
      }
      return matches[0].version;
    });
    if (new Set(versions).size !== 1) {
      throw Error("Adopted versions differ across architectures");
    }
    version = versions[0];
  }

  const context = {
    repository: repo,
    snap,
    channel: candidate,
    destination,
    version,
    rows,
  };

  const issue = await marked(
    `/repos/${repo}/issues`,
    {
      title: `Call for testing \`${snap}\` on channel \`${candidate}\``,
      labels: ["testing"],
      body: testingBody(context, input("testing-instructions")),
    },
    marker(context),
    token,
  );
  outputs({ number: String(issue.number) });
}

export async function runTests() {
  const p = project(input("snapcraft-project-root"));
  const snap = snapName(p.outputs["snap-name"]);
  const repo = repository(process.env.GITHUB_REPOSITORY!);
  const token = input("github-token");
  const issue = revision(input("issue-number"));
  const arch = architecture(command("dpkg", ["--print-architecture"]).trim());

  const rows = await fetchManifests(token, repo, process.env.GITHUB_RUN_ID!, process.cwd(), {
    snap,
  });
  const selected = rows.find((r) => r.architecture === arch);
  if (rows.length && !selected) {
    throw Error("Missing test architecture manifest");
  }

  command("sudo", [
    "snap",
    "install",
    snap,
    ...(selected ? ["--revision", selected.revision] : ["--channel", channel(input("channel"))]),
    ...(p.outputs.classic === "true" ? ["--classic"] : []),
  ]);

  const result = await script(input("test-script"), process.cwd());
  try {
    await marked(
      `/repos/${repo}/issues/${issue}/comments`,
      {
        body: `Automated testing ${result.code ? "failure" : "success"}.\n\n<details><summary>Logs</summary>\n\n\`\`\`\n${result.summary.replaceAll("```", "~~~")}\n\`\`\`\n</details>\n\nFull logs: https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`,
      },
      marker([repo, issue, process.env.GITHUB_RUN_ID, "tests"]),
      token,
    );
  } catch {
    console.warn("Test reporting failed; preserved the original test result");
  }

  try {
    result.cleanup();
  } catch {
    console.warn("Could not remove private test logs");
  }

  process.exitCode = result.code;
}
