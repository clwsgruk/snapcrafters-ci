import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

import { parse } from "yaml";

const files = readdirSync(".")
  .filter((p) => !p.startsWith("."))
  .flatMap((p) => {
    try {
      readFileSync(`${p}/action.yaml`);
      return [`${p}/action.yaml`];
    } catch {
      return [];
    }
  });
files.push(...readdirSync(".github/workflows").map((p) => `.github/workflows/${p}`));

let count = 0;
for (const file of files) {
  const doc = parse(readFileSync(file, "utf8")) as {
    runs?: { steps: Step[] };
    jobs?: Record<string, { steps?: Step[] }>;
  };
  const steps = doc.runs?.steps || Object.values(doc.jobs || {}).flatMap((j) => j.steps || []);
  for (const step of steps) {
    if (step.run) {
      const header = Object.keys(step.env || {})
        .map((k) => `export ${k}=''`)
        .join("\n");

      try {
        execFileSync("shellcheck", ["--shell=bash", "-"], {
          input: `${header}\n${step.run.replace(/\$\{\{.*?}}/gs, "value")}`,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error) {
        console.error(file);
        throw error;
      }
      count++;
    }
  }
}

console.log(`ShellCheck passed for ${count} inline scripts`);

interface Step {
  run?: string;
  env?: Record<string, string>;
}
