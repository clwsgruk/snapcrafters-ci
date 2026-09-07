import { project } from "../src/project.ts";
import { input, main, outputs } from "../src/runtime.ts";

void main(() => outputs(project(input("snapcraft-project-root")).outputs));
