import { test, expect } from "vitest";
import { action, pins, expectedUses } from "./wrappers.ts";
test.each(Object.keys(expectedUses))(
  "%s pins each required dependency and routes every public input/output",
  (name) => {
    const a = action(name),
      steps = a.runs.steps;
    expect(steps.filter((s) => s.uses).map((s) => s.uses)).toEqual(
      expectedUses[name].map((u) => `${u}@${pins[u as keyof typeof pins]}`),
    );
    for (const input of Object.keys(a.inputs || {})) {
      const expression = `\${{ inputs.${input} }}`;
      const values = steps.flatMap((s) => [
        ...Object.entries(s.env || {}),
        ...Object.entries(s.with || {}),
      ]);
      expect(
        values.some(([, v]) => v === expression) ||
          steps.some((s) => s.if === `inputs.${input} == 'true'`),
      ).toBe(true);
      const envKey = `INPUT_${input.toUpperCase().replaceAll("-", "_")}`;
      if (
        !["review-snap"].includes(name) &&
        !["token", "repo-token", "snapcraft-channel", "install"].includes(input)
      )
        expect(values).toContainEqual([envKey, expression]);
    }
    for (const output of Object.values(a.outputs || {})) {
      const match = output.value.match(/^\$\{\{ steps\.([\w-]+)\.outputs\.([\w-]+) }}$/);
      expect(match).not.toBeNull();
      expect(steps.some((s) => s.id === match![1])).toBe(true);
    }
    for (const step of steps.filter((s) => s.run?.includes("dist/index.cjs")))
      expect(step.env?.CI_PHASE).toBeTruthy();
    const checkout = steps.find((s) => s.uses?.startsWith("actions/checkout@"));
    if (name === "sync-version")
      expect(checkout?.with).toEqual({ token: "${{ inputs.token }}", ref: "${{ inputs.branch }}" });
    else if (name === "release-to-candidate")
      expect(checkout?.with).toEqual({ token: "${{ inputs.repo-token }}", "fetch-depth": 0 });
    else if (checkout) expect(checkout.with).toBeUndefined();
  },
);

test("release preserves existing manifest artifacts and verifies them before the tag phase", () => {
  const steps = action("release-to-candidate").runs.steps;
  const upload = steps.find((s) => s.with?.name === "manifest-${{ inputs.architecture }}")!;
  expect(upload.with?.overwrite).toBe("false");
  expect(upload["continue-on-error"]).toBe(true);
  const verify = steps.findIndex((s) => s.env?.CI_PHASE === "artifact");
  expect(verify).toBeGreaterThan(steps.indexOf(upload));
  expect(verify).toBeLessThan(steps.findIndex((s) => s.env?.CI_PHASE === "tag"));
  expect(steps[verify].env?.INPUT_REPO_TOKEN).toBe("${{ inputs.repo-token }}");
});

test("every action keeps the reviewed step input routes, output routes and conditions", async () => {
  const { default: routes } = await import("./fixtures/wrapper-routes.json");
  for (const name of Object.keys(expectedUses)) {
    const value = action(name);
    expect({
      outputs: value.outputs || {},
      steps: value.runs.steps.map(({ id, env, with: inputs, if: condition }) => ({
        id,
        env,
        with: inputs,
        if: condition,
      })),
    }).toEqual(routes[name as keyof typeof routes]);
  }
});
