import { readFile, writeFile } from "node:fs/promises";
import { parse } from "yaml";

const setupNode = "249970729cb0ef3589644e2896645e5dc5ba9c38";
const checkout = "d23441a48e516b6c34aea4fa41551a30e30af803";
const uploadArtifact = "b7c566a772e6b6bfb58ed0dc250532a479d7789f";
const actionBuild = "3bdaa03e1ba6bf59a65f84a751d943d549a54e79";
const setupLxd = "4e959f8e0d9c5feb27d44c5e4d9a330a782edee0";

const actions: Record<
  string,
  { id?: string; before?: string; afterNode?: string; after?: string; extraEnv?: string }
> = {
  "call-for-testing": { id: "issue", before: checkoutStep() },
  "fetch-manifests": {},
  "get-architectures": { id: "architectures", before: checkoutStep() },
  "get-screenshots": {
    id: "screenshots",
    before: `${contextBoundaryStep()}${checkoutStep()}    - name: Enable KVM on the GitHub Actions runner
      shell: bash
      run: |
        echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' | sudo tee /etc/udev/rules.d/99-kvm4all.rules
        sudo udevadm control --reload-rules
        sudo udevadm trigger --name-match=kvm
    - name: Setup LXD
      uses: canonical/setup-lxd@${setupLxd} # v0.1.1
`,
  },
  "parse-snapcraft-yaml": { id: "parse" },
  "promote-to-stable": { before: checkoutStep() },
  "release-to-candidate": {
    id: "publish",
    before: checkoutStep("        token: ${{ inputs.repo-token }}\n        fetch-depth: 0"),
    after: `    - name: Upload revision manifest
      uses: actions/upload-artifact@${uploadArtifact} # v6
      with:
        name: manifest-\${{ inputs.architecture }}
        path: manifest-\${{ inputs.architecture }}.yaml
    - name: Create revision tag
      shell: bash
      env:
${["architecture", "bot-email", "bot-name", "multi-snap"]
  .map(
    (name) => `        INPUT_${name.toUpperCase().replaceAll("-", "_")}: \${{ inputs.${name} }}\n`,
  )
  .join("")}        INPUT_PUBLISHED_REVISION: \${{ steps.publish.outputs.revision }}
        SNAPCRAFTERS_PHASE: tag
      run: node "\${{ github.action_path }}/dist/index.cjs"
`,
  },
  "review-snap": {},
  "run-tests": { before: checkoutStep() },
  "setup-ghvmctl": {
    before: contextBoundaryStep(),
    extraEnv: '        SNAPCRAFTERS_PHASE: ""\n',
    afterNode: `    - name: Validate action context
      shell: bash
      env:
        SNAPCRAFTERS_PHASE: validate
      run: node "\${{ github.action_path }}/dist/index.cjs"
    - name: Enable KVM on the GitHub Actions runner
      shell: bash
      run: |
        echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' | sudo tee /etc/udev/rules.d/99-kvm4all.rules
        sudo udevadm control --reload-rules
        sudo udevadm trigger --name-match=kvm
    - name: Setup LXD
      uses: canonical/setup-lxd@${setupLxd} # v0.1.1
`,
  },
  "sync-version": {
    before: checkoutStep("        token: ${{ inputs.token }}\n        ref: ${{ inputs.branch }}"),
  },
  "test-snap-build": {
    before: `${checkoutStep()}    - name: Build snap
      uses: snapcore/action-build@${actionBuild} # v1
      id: build
      with:
        path: \${{ inputs.snapcraft-project-root }}
        snapcraft-channel: \${{ inputs.snapcraft-channel }}
`,
    extraEnv: "        INPUT_SNAP: ${{ steps.build.outputs.snap }}\n",
  },
};

function checkoutStep(withBlock = ""): string {
  return `    - name: Checkout the source
      uses: actions/checkout@${checkout} # v6
${withBlock ? `      with:\n${withBlock}\n` : ""}`;
}

function contextBoundaryStep(): string {
  return `    - name: Validate hosted runner
      shell: bash
      run: |
        if [[ "\${GITHUB_ACTIONS:-}" != "true" || "\${GITHUB_SERVER_URL:-}" != "https://github.com" || "\${RUNNER_ENVIRONMENT:-}" != "github-hosted" || "\${RUNNER_OS:-}" != "Linux" || ! "\${ImageOS:-}" =~ ^ubuntu(22|24)$ ]]; then
          printf '%s\\n' 'Unsupported GitHub Actions runner capability' >&2
          exit 1
        fi
`;
}

for (const [action, config] of Object.entries(actions)) {
  const file = `${action}/action.yaml`;
  const source = await readFile(file, "utf8");
  const boundary = source.indexOf("\nruns:\n");
  if (boundary < 0) throw new Error(`Missing runs boundary in ${file}`);
  const metadata = parse(source) as { inputs?: Record<string, unknown> };
  const env = Object.keys(metadata.inputs ?? {})
    .filter((name) => !(action === "release-to-candidate" && name === "repo-token"))
    .map(
      (name) =>
        `        INPUT_${name.toUpperCase().replaceAll("-", "_")}: \${{ inputs.${name} }}\n`,
    )
    .join("");
  const id = config.id ? `      id: ${config.id}\n` : "";
  const envBlock = env || config.extraEnv ? `      env:\n${env}${config.extraEnv ?? ""}` : "";
  const rendered = `${source.slice(0, boundary)}
runs:
  using: composite
  steps:
${config.before ?? ""}    - name: Setup Node 24
      uses: actions/setup-node@${setupNode} # v6
      with:
        node-version: "24.20.0"
${config.afterNode ?? ""}    - name: Run ${action}
${id}      shell: bash
${envBlock}      run: node "\${{ github.action_path }}/dist/index.cjs"
${config.after ?? ""}`;
  await writeFile(file, rendered);
}
