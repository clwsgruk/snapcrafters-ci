import { AuthorizationError, InputError, PartialPublicationError } from "../runtime/errors.js";

export interface PromotionInput {
  eventName: string;
  action: string;
  repository: string;
  issue: number;
  actor: string;
  comment: string;
  configuredChannel: string;
  snap: string;
  edited: boolean;
  deliveryId: string;
}

export interface PromotionIssue {
  repository: string;
  body: string;
  state: "open" | "closed";
  isPullRequest: boolean;
  labels: string[];
}

export interface PromotionResult {
  released: string[];
  failed?: string;
  closed: boolean;
}

export async function promote(
  input: PromotionInput,
  deps: {
    permission(actor: string): Promise<string>;
    react(): Promise<void>;
    issue(): Promise<PromotionIssue>;
    isReleased(revision: string, channel: string): Promise<boolean>;
    release(revision: string, channel: string): Promise<void>;
    comment(body: string): Promise<void>;
    close(): Promise<void>;
  },
): Promise<PromotionResult> {
  if (input.eventName !== "issue_comment" || input.action !== "created")
    throw new InputError("Promotion requires a newly created issue comment");
  if (input.edited) throw new InputError("Edited promotion comments are not accepted");
  if (!/^[1-9][0-9]*:[1-9][0-9]*$/.test(input.deliveryId))
    throw new InputError("Invalid promotion delivery identity");
  const parsed = parsePromotionCommand(input.comment);
  if (parsed.channel !== input.configuredChannel)
    throw new InputError("Requested channel does not match configured channel");
  const permission = await deps.permission(input.actor);
  if (!new Set(["write", "maintain", "admin"]).has(permission))
    throw new AuthorizationError("Write permission is required for promotion");
  await deps.react();
  const issue = await deps.issue();
  if (
    issue.repository !== input.repository ||
    issue.state !== "open" ||
    issue.isPullRequest ||
    !issue.labels.includes("testing")
  )
    throw new InputError("Promotion requires an open testing issue in the source repository");
  validateIssueSnap(issue.body, input.snap);
  const allowed = parseAllowedRevisions(issue.body, parsed.channel);
  const unrelated = parsed.revisions.filter((revision) => !allowed.has(revision));
  if (unrelated.length)
    throw new InputError(`Unrelated requested revisions: ${unrelated.join(",")}`);

  const released: string[] = [];
  for (const revision of parsed.revisions) {
    try {
      if (!(await deps.isReleased(revision, parsed.channel))) {
        await deps.release(revision, parsed.channel);
        if (!(await deps.isReleased(revision, parsed.channel)))
          throw new Error(`Store release readback did not confirm revision ${revision}`);
      }
      released.push(revision);
    } catch (releaseError) {
      try {
        await deps.comment(
          withDelivery(
            `Released revisions: ${released.join(",") || "none"}. Revision ${revision} failed; no later revisions were attempted.`,
            input.deliveryId,
          ),
        );
      } catch (reportError) {
        throw new PartialPublicationError(
          `Released revisions ${released.join(",") || "none"}; revision ${revision} and failure reporting failed`,
          released.map((item) => `release:${item}`),
          { cause: new AggregateError([releaseError, reportError]) },
        );
      }
      return { released, failed: revision, closed: false };
    }
  }
  try {
    await deps.comment(
      withDelivery(
        `The following revisions were released to \`${parsed.channel}\`: \`${released.join(",")}\`.`,
        input.deliveryId,
      ),
    );
  } catch (error) {
    throw new PartialPublicationError(
      `Released revisions ${released.join(",")}; success report failed`,
      released.map((item) => `release:${item}`),
      { cause: error },
    );
  }
  if (parsed.done) {
    try {
      await deps.close();
      if ((await deps.issue()).state !== "closed")
        throw new Error("Issue close was not confirmed");
    } catch (error) {
      throw new PartialPublicationError(
        `Released revisions ${released.join(",")}; issue close failed`,
        [...released.map((item) => `release:${item}`), "comment"],
        { cause: error },
      );
    }
  }
  return { released, closed: parsed.done };
}

function withDelivery(body: string, deliveryId: string): string {
  return `${body}\n\n<!-- snapcrafters-ci:promotion:${deliveryId} -->`;
}

function validateIssueSnap(body: string, snap: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(snap)) throw new InputError("Invalid promotion snap");
  const escaped = snap.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp("^A new version \\(.+\\) of `" + escaped + "` was just pushed", "m").test(body))
    throw new InputError("Testing issue is not bound to the requested snap");
}

export function parsePromotionCommand(value: string): {
  revisions: string[];
  channel: string;
  done: boolean;
} {
  const match =
    /^\/promote ([1-9][0-9]*(?:,[1-9][0-9]*)*) ([a-z0-9][a-z0-9-]*\/(?:stable|candidate|beta|edge)(?:\/[a-z0-9][a-z0-9-]*)?)(?: (done))?$/.exec(
      value,
    );
  if (!match) throw new InputError("Malformed promotion command");
  const revisions = match[1]!.split(",");
  if (new Set(revisions).size !== revisions.length)
    throw new InputError("Duplicate promotion revision");
  return { revisions, channel: match[2]!, done: match[3] === "done" };
}

export function parseAllowedRevisions(body: string, expectedChannel?: string): Set<string> {
  if (Buffer.byteLength(body) > 1024 * 1024) throw new InputError("Issue body exceeds size limit");
  const records: ReturnType<typeof parsePromotionCommand>[] = [];
  for (const line of body.split("\n")) {
    try {
      records.push(parsePromotionCommand(line.trim()));
    } catch {}
  }
  if (records.length !== 1)
    throw new InputError("Issue must contain a single unambiguous testing revision record");
  const record = records[0]!;
  return new Set(!expectedChannel || record.channel === expectedChannel ? record.revisions : []);
}
