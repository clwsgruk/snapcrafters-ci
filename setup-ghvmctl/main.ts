import { command } from "../src/execution.ts";
import { main } from "../src/runtime.ts";
void main(() => {
  if (!/^ghvmctl\s+0\.4\.1\s+16\s/m.test(command("snap", ["list", "ghvmctl"])))
    throw Error("Expected ghvmctl 0.4.1 revision 16");
});
