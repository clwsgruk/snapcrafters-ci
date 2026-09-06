import type { Architecture } from "../project/types.js";

export interface Published {
  snap: string;
  revision: string;
  channel: string;
  architecture: Architecture;
  version: string;
  digest: string;
  sourceSha: string;
}

export interface StoreRevision {
  revision: string;
  architecture: Architecture;
  version: string;
  digest?: string;
}

export interface SnapIdentity {
  name: string;
  version: string;
  architecture: Architecture;
}

export interface ReleaseResult {
  published: Published;
  completedStages: readonly string[];
  manifestPath: string;
}
