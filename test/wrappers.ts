import { parse } from "yaml";
import { readFileSync } from "node:fs";
export const pins = {
  "actions/setup-node": "249970729cb0ef3589644e2896645e5dc5ba9c38",
  "actions/checkout": "d23441a48e516b6c34aea4fa41551a30e30af803",
  "snapcore/action-build": "3bdaa03e1ba6bf59a65f84a751d943d549a54e79",
  "canonical/setup-lxd": "4e959f8e0d9c5feb27d44c5e4d9a330a782edee0",
  "actions/upload-artifact": "b7c566a772e6b6bfb58ed0dc250532a479d7789f",
  "actions/download-artifact": "018cc2cf5baa6db3ef3c5f8a56943fffe632ef53",
};
export const expectedUses: Record<string, string[]> = {
  "parse-snapcraft-yaml": ["actions/setup-node"],
  "get-architectures": ["actions/setup-node", "actions/checkout"],
  "sync-version": ["actions/setup-node", "actions/checkout"],
  "review-snap": ["actions/setup-node"],
  "setup-ghvmctl": ["actions/setup-node", "canonical/setup-lxd"],
  "test-snap-build": ["actions/setup-node", "actions/checkout", "snapcore/action-build"],
  "fetch-manifests": ["actions/setup-node"],
  "release-to-candidate": [
    "actions/setup-node",
    "actions/checkout",
    "actions/download-artifact",
    "actions/upload-artifact",
    "actions/upload-artifact",
  ],
  "call-for-testing": ["actions/setup-node", "actions/checkout"],
  "get-screenshots": ["actions/setup-node", "actions/checkout", "canonical/setup-lxd"],
  "run-tests": ["actions/setup-node", "actions/checkout"],
  "promote-to-stable": ["actions/setup-node", "actions/checkout"],
};
export interface Step {
  "continue-on-error"?: boolean;
  uses?: string;
  id?: string;
  run?: string;
  if?: string;
  shell?: string;
  env?: Record<string, string>;
  with?: Record<string, string | number>;
}
export interface Action {
  inputs?: Record<string, { default?: string }>;
  outputs?: Record<string, { value: string }>;
  runs: { steps: Step[] };
}
export const action = (name: string): Action => parse(readFileSync(`${name}/action.yaml`, "utf8"));
