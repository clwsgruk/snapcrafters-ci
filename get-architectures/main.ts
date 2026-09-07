import { architectures, project } from "../src/project.ts";
import { input, main, outputs } from "../src/runtime.ts";

void main(() => {
  const list = architectures(project(input("snapcraft-project-root")).data);
  outputs({ architectures: list.join(" "), architectures_list: JSON.stringify(list) });
});
