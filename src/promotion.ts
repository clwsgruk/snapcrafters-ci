import { readFileSync, statSync } from "node:fs";

import { command, safeEnv } from "./execution.ts";
import { api, request, marked, marker } from "./github.ts";
import { revision } from "./manifests.ts";
import { project } from "./project.ts";
import { input } from "./runtime.ts";
import { testingIssue } from "./testing.ts";
import { channel, repository, snapName, revisions } from "./validation.ts";

export function promoteCommand(body: string) {
  const match = body.match(/^\/promote ([1-9][0-9]*(?:,[1-9][0-9]*)*) ([A-Za-z0-9./+-]+)( done)?$/);
  if (!match || match[0] !== body) {
    throw Error("Expected /promote REV[,REV] TRACK/RISK [done]");
  }

  const list = match[1].split(",").map(revision);
  if (list.length > 7 || new Set(list).size !== list.length) {
    throw Error("Duplicate or excessive revisions");
  }
  return { revisions: list, channel: channel(match[2]), done: Boolean(match[3]) };
}

interface Comment {
  id: number;
  body: string;
  user: { login: string };
  created_at: string;
  updated_at: string;
}

interface Event {
  action: string;
  repository: { full_name: string };
  sender: { login: string };
  issue: { number: number };
  comment: Comment;
}

export async function promote(
  event: Event,
  repo: string,
  snap: string,
  destination: string,
  token: string,
  storeToken: string,
  base = api,
) {
  repository(repo);
  snapName(snap);
  channel(destination);
  if (event.action !== "created" || event.repository.full_name !== repo) {
    throw Error("Requires a newly created repository issue comment");
  }

  const issueId = revision(String(event.issue.number));
  const commentId = revision(String(event.comment.id));
  const issuePath = `/repos/${repo}/issues/${issueId}`;
  const current = await request<Comment>(
    "GET",
    `/repos/${repo}/issues/comments/${commentId}`,
    token,
    undefined,
    base,
  );
  if (
    current.id !== event.comment.id ||
    current.body !== event.comment.body ||
    current.user.login !== event.sender.login ||
    current.created_at !== current.updated_at ||
    current.created_at !== event.comment.created_at
  ) {
    throw Error("Requires an unedited original comment");
  }

  const parsed = promoteCommand(current.body);
  const permission = await request<{ permission: string }>(
    "GET",
    `/repos/${repo}/collaborators/${encodeURIComponent(current.user.login)}/permission`,
    token,
    undefined,
    base,
  );
  if (!["admin", "maintain", "write"].includes(permission.permission)) {
    throw Error("Current write permission required");
  }

  const issue = await request<{
    state: string;
    pull_request?: unknown;
    labels: { name: string }[];
    body: string;
  }>("GET", issuePath, token, undefined, base);
  if (
    issue.state !== "open" ||
    issue.pull_request ||
    !issue.labels.some((l) => l.name === "testing")
  ) {
    throw Error("Requires an open non-PR testing issue");
  }

  const context = testingIssue(issue.body, repo, snap, destination);
  if (parsed.channel !== destination) {
    throw Error("Unrelated destination channel");
  }
  const selected = context.rows.filter((r) => parsed.revisions.includes(r.revision));
  if (parsed.revisions.some((r) => !selected.some((row) => row.revision === r))) {
    throw Error("Unrelated revision: no Store writes performed");
  }
  if (!storeToken) {
    throw Error("Store credentials required");
  }

  const env = { ...safeEnv(), SNAPCRAFT_STORE_CREDENTIALS: storeToken };
  const active = (arch: string, rev: string, target: string) => {
    const output = command("snapcraft", ["revisions", snap, "--arch", arch], process.cwd(), env);
    return revisions(output).some(
      (r) =>
        r.revision === rev && r.architectures.includes(arch) && r.channels.includes(`${target}*`),
    );
  };

  for (const row of selected) {
    if (
      !active(row.architecture, row.revision, context.channel) &&
      !active(row.architecture, row.revision, destination)
    ) {
      throw Error("Unrelated Store revision/channel: no writes performed");
    }
  }

  const succeeded: string[] = [];
  let failed: string | undefined;
  for (const rev of parsed.revisions) {
    const rows = selected.filter((r) => r.revision === rev);
    try {
      if (!rows.every((r) => active(r.architecture, rev, destination))) {
        try {
          command("snapcraft", ["release", snap, rev, destination], process.cwd(), env);
        } catch {
          /* read back ambiguous writes */
        }
        if (!rows.every((r) => active(r.architecture, rev, destination))) {
          throw Error("Release not confirmed");
        }
      }
      succeeded.push(rev);
    } catch {
      failed = rev;
      break;
    }
  }

  const outcome = `Promoted revisions: ${succeeded.join(", ") || "none"}.${failed ? ` Revision ${failed} is unconfirmed; remaining revisions were not attempted.` : ` All requested revisions are active on ${destination}.`}`;
  try {
    await marked(
      `${issuePath}/comments`,
      { body: outcome },
      marker([repo, commentId, succeeded, failed]),
      token,
      base,
    );
  } catch {
    throw Error(
      `${outcome} GitHub reporting failed; replay will verify Store state before writing.`,
    );
  }
  if (failed) {
    throw Error(outcome);
  }

  const reactionsPath = `/repos/${repo}/issues/comments/${commentId}/reactions`;
  // GitHub's reaction creation is idempotent for a user/content pair and works with installation tokens.
  await request("POST", reactionsPath, token, { content: "+1" }, base);

  if (parsed.done) {
    try {
      await request("PATCH", issuePath, token, { state: "closed" }, base);
    } catch (error) {
      if (
        (await request<{ state: string }>("GET", issuePath, token, undefined, base)).state !==
        "closed"
      ) {
        throw error;
      }
    }
  }
}

export async function promotionAction() {
  const eventFile = process.env.GITHUB_EVENT_PATH!;
  if (statSync(eventFile).size > 1024 * 1024) {
    throw Error("Event too large");
  }

  return promote(
    JSON.parse(readFileSync(eventFile, "utf8")) as Event,
    process.env.GITHUB_REPOSITORY!,
    project(input("snapcraft-project-root")).outputs["snap-name"],
    input("channel"),
    input("github-token"),
    input("store-token"),
  );
}
