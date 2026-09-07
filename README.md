# Snapcrafters CI

Twelve composite actions for building, reviewing, testing and publishing one selected snap project.
Snapcraft, snap, review-tools, LXD and ghvmctl remain external tools. Orchestration lives in small
TypeScript feature modules; action-local adapters have committed Node 24 bundles.

| Action                                                 | Purpose                                                           |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| [parse-snapcraft-yaml](parse-snapcraft-yaml/README.md) | Locate a project and serialize its metadata                       |
| [get-architectures](get-architectures/README.md)       | Produce explicit architecture matrices                            |
| [sync-version](sync-version/README.md)                 | Run a trusted update script and commit tracked changes            |
| [test-snap-build](test-snap-build/README.md)           | Build locally and review                                          |
| [review-snap](review-snap/README.md)                   | Invoke review-tools                                               |
| [release-to-candidate](release-to-candidate/README.md) | Remote-build and publish one architecture                         |
| [fetch-manifests](fetch-manifests/README.md)           | Download and validate this run's revision manifests               |
| [call-for-testing](call-for-testing/README.md)         | Create a testing issue bound to exact revisions                   |
| [setup-ghvmctl](setup-ghvmctl/README.md)               | Install ghvmctl 0.4.1 revision 16 and configure KVM/LXD           |
| [get-screenshots](get-screenshots/README.md)           | Capture and atomically commit two PNGs                            |
| [run-tests](run-tests/README.md)                       | Run trusted Bash with private complete logs and bounded reporting |
| [promote-to-stable](promote-to-stable/README.md)       | Authorize and reconcile exact revision promotions                 |

Public names, defaults, required flags and output expressions are frozen from upstream
`cb43fba979fbb7388ec44f37b1e70d6cdb8edb8c`. `action.yaml` is the authoritative interface.
Use github.com-hosted Ubuntu 22.04 or 24.04. Wrappers require Node 24 before privileged work;
`setup-ghvmctl` performs shell-only host validation first, installs Node 24, then validates the
runtime before any privileged setup.

Use mise for development:

```sh
mise install
mise run install
mise run ci
```

`mise run fmt`, `mise run test`, `mise run build` and `mise run size` are the focused entry points.
Bun manages the frozen dependency lock. Vite+ supplies formatting, linting, type checks and tests.
Feature tests are colocated as `src/<feature>.test.ts`; the size-gate test sits beside its script.
Shared harnesses and immutable fixture data live under `test-support/`.
CI also runs actionlint, ShellCheck for every inline script, source budgets, and two independent
frozen builds compared with committed bundles and licenses. Generated `*/dist/*` files must be
rebuilt and committed with source changes. The final comparison intentionally fails until the
matching generated files have been committed.

The fresh [inventory](test-support/fixtures/inventory.md) records 87 active repositories and 80 immutable
recipes using 38 compact schema shapes. Omitted architectures, unknown bases and ambiguous
platform semantics fail clearly. Project paths are resolved internally while public path spelling
is preserved. `ci-repo` overrides are deprecated: pin the forked action itself.

See [operational behavior and recovery](docs/operations.md), [publishing examples](docs/publishing.md),
and [actual TDD evidence](docs/tdd-evidence.md). Pure parsing/validation has a 90% branch coverage
gate. Overall coverage is reported without a global percentage target. Tests use real Bash, local
Git remotes, private files, local HTTP servers and strict fake executables; no live publication or
VM integration is performed by the test suite.
