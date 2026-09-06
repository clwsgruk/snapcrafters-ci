import { AuthorizationError, InputError, PartialPublicationError } from "../runtime/errors.js";

export interface PromotionInput {
  eventName: string;
  action: string;
  repository: string;
  issue: number;
  actor: string;
  comment: string;
  configuredChannel: string;
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
    issueBody(): Promise<string>;
    release(revision: string, channel: string): Promise<void>;
    comment(body: string): Promise<void>;
    close(): Promise<void>;
  },
): Promise<PromotionResult> {
  if (input.eventName !== "issue_comment" || input.action !== "created")
    throw new InputError("Promotion requires a newly created issue comment");
  const parsed = parsePromotionCommand(input.comment);
  if (parsed.channel !== input.configuredChannel)
    throw new InputError("Requested channel does not match configured channel");
  const permission = await deps.permission(input.actor);
  if (!new Set(["write", "maintain", "admin"]).has(permission))
    throw new AuthorizationError("Write permission is required for promotion");
  const allowed = parseAllowedRevisions(await deps.issueBody(), parsed.channel);
  const unrelated = parsed.revisions.filter((revision) => !allowed.has(revision));
  if (unrelated.length)
    throw new InputError(`Unrelated requested revisions: ${unrelated.join(",")}`);

  const released: string[] = [];
  for (const revision of parsed.revisions) {
    try {
      await deps.release(revision, parsed.channel);
      released.push(revision);
    } catch (releaseError) {
      try {
        await deps.comment(
          `Released revisions: ${released.join(",") || "none"}. Revision ${revision} failed; no later revisions were attempted.`,
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
      `The following revisions were released to \`${parsed.channel}\`: \`${released.join(",")}\`.`,
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
  const allowed = new Set<string>();
  let foundRecord = false;
  for (const line of body.split("\n")) {
    try {
      const parsed = parsePromotionCommand(line.trim());
      foundRecord = true;
      if (!expectedChannel || parsed.channel === expectedChannel)
        for (const revision of parsed.revisions) allowed.add(revision);
    } catch {}
  }
  if (!foundRecord) throw new InputError("Issue does not contain a valid testing revision record");
  return allowed;
}
