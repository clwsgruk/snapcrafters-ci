import { fetchManifests } from "../src/manifests.ts";
import { input, main } from "../src/runtime.ts";

void main(() =>
  fetchManifests(input("token"), process.env.GITHUB_REPOSITORY!, process.env.GITHUB_RUN_ID!),
);
