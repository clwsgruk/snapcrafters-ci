import * as core from "@actions/core";
import type { ActionContext } from "../actions/context.js";
import { actionContext } from "../actions/context.js";
import { optional } from "../actions/inputs.js";
import { getBuildTargets } from "./architectures.js";
import { parseProject } from "./parse.js";

async function project(env: NodeJS.ProcessEnv): Promise<ReturnType<typeof parseProject>> {
  const context: ActionContext = await actionContext(env);
  return parseProject(context.workspace, optional(env, "snapcraft-project-root"));
}

export async function runParseAction(env: NodeJS.ProcessEnv): Promise<void> {
  const parsed = await project(env);
  core.setOutput("classic", String(parsed.classic));
  core.setOutput(
    "components",
    parsed.components.map((item) => `${item.name}|${item.version ?? "null"}`).join(","),
  );
  core.setOutput("plugs-file", parsed.plugsFile ?? "");
  core.setOutput("project-root", parsed.publicRoot);
  core.setOutput("slots-file", parsed.slotsFile ?? "");
  core.setOutput("snap-name", parsed.name);
  core.setOutput("version", parsed.version ?? "null");
  core.setOutput("yaml-path", parsed.publicYamlPath);
}

export async function runArchitecturesAction(env: NodeJS.ProcessEnv): Promise<void> {
  const architectures = getBuildTargets((await project(env)).document).map(
    (target) => target.buildFor,
  );
  core.setOutput("architectures", architectures.join(" "));
  core.setOutput("architectures-list", JSON.stringify(architectures));
}
