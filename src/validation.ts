import { revision } from "./manifests.ts";
import { architecture } from "./project.ts";

export function snapName(value: string) {
  if (!/^(?=.{1,40}$)(?=.*[a-z])[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw Error("Invalid snap name");
  }

  return value;
}

export function channel(value: string) {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9.+-]*\/(stable|candidate|beta|edge)(\/[a-zA-Z0-9][a-zA-Z0-9.+-]*)?$/.test(
      value,
    ) ||
    value.length > 100
  ) {
    throw Error("Invalid channel");
  }

  return value;
}

export function repository(value: string) {
  if (!/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/.test(value) || value.length > 200) {
    throw Error("Invalid repository");
  }

  return value;
}

export interface Revision {
  revision: string;
  architectures: string[];
  version: string;
  channels: string[];
}

export function revisions(text: string): Revision[] {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  if (!/^Rev\.\s+Uploaded\s+Arches\s+Version(\s+Channels)?$/.test(header)) {
    throw Error("Unrecognized Snapcraft revisions header");
  }

  const width = header.endsWith("Channels") ? 5 : 4;
  return lines.filter(Boolean).map((line) => {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== width || !/^\d{4}-\d\d-\d\d(?:T[\d:.]+Z?)?$/.test(fields[1])) {
      throw Error("Unrecognized Snapcraft revision row");
    }

    return {
      revision: revision(fields[0]),
      architectures: fields[2].split(",").map(architecture),
      version: fields[3],
      channels: (fields[4] || "")
        .split(",")
        .filter((c) => c.endsWith("*"))
        .map((c) => `${channel(c.slice(0, -1))}*`),
    };
  });
}
