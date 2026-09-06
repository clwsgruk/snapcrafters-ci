export type Architecture = "amd64" | "arm64" | "armhf" | "i386" | "ppc64el" | "riscv64" | "s390x";

export interface Component {
  name: string;
  version?: string;
}

export interface Project {
  root: string;
  yamlPath: string;
  publicRoot: string;
  publicYamlPath: string;
  name: string;
  version?: string;
  adoptInfo?: string;
  classic: boolean;
  base?: string;
  components: Component[];
  plugsFile?: string;
  slotsFile?: string;
  document: Record<string, unknown>;
}

export interface BuildTarget {
  platform?: string;
  buildOn: Architecture[];
  buildFor: Architecture;
}
