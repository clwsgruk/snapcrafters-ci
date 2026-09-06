import { architecture, channel } from "../actions/inputs.js";
import { InputError } from "../runtime/errors.js";

export function validateIssueHeader(body: string, snap: string, destination: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(snap)) throw new InputError("Invalid promotion snap");
  const escaped = snap.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [
    ...body.matchAll(
      new RegExp(
        "^A new version \\([^\\r\\n]+\\) of `" +
          escaped +
          "` was just pushed to the `([^`]+)` channel\\. The following revisions are available\\.$",
        "gm",
      ),
    ),
  ];
  if (matches.length !== 1)
    throw new InputError("Testing issue is not bound to the requested snap");
  const source = channel(matches[0]![1]!);
  if (source === destination)
    throw new InputError("Testing and promotion channels must be distinct");
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
  if (expectedChannel && record.channel !== expectedChannel) return new Set();
  const bodies = [...body.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)];
  if (bodies.length !== 1) throw new InputError("Issue must contain one revision table");
  const tableBody = bodies[0]![1]!;
  const rows = [...tableBody.matchAll(/<tr><td>([^<]+)<\/td><td>([1-9][0-9]*)<\/td><\/tr>/g)];
  if (!rows.length || rows.map((row) => row[0]).join("") !== tableBody)
    throw new InputError("Malformed testing revision table");
  const tableRevisions = rows.map((row) => {
    architecture(row[1]!);
    return row[2]!;
  });
  if (
    new Set(tableRevisions).size !== tableRevisions.length ||
    tableRevisions.length !== record.revisions.length ||
    tableRevisions.some((revision, index) => revision !== record.revisions[index])
  )
    throw new InputError("Promotion command does not match the testing revision table");
  return new Set(tableRevisions);
}
