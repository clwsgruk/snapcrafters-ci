# TDD evidence

Commands in this file were run from `/home/jon/snapcrafters-ci-reimplementation` on
2026-09-06. External write-enabled acceptance is intentionally excluded.

## Inventory prerequisite

- `gh auth status` — PASS, authenticated as `clwsgruk`.
- `gh api 'orgs/snapcrafters/repos?per_page=100&type=public' --paginate --jq ...` — PASS,
  118 repositories across all pages.
- Immutable recursive-tree and blob reads for every active repository — PASS, all 87
  non-archived/non-disabled repositories checked and 80 recipe blobs captured.

## Phase 1 — Freeze interfaces

The first contract test intentionally precedes all action adapters and rejects missing adapters,
mutable sibling references, and public metadata drift.

- `mise run test:contract` — RED as expected: `call-for-testing/main.ts` was absent. The
  initial global-vs-local Vite+ invocation also exposed duplicate Vitest runtime state; mise tasks
  now invoke the locked project-local `vp` while retaining Vite+ as the sole frontend.
- `mise run test:contract` — GREEN: 1 file, 1 test.
- `mise run check` — GREEN: 62 formatted files; 30 linted/type-checked files, zero warnings or
  errors.
- `bun scripts/check-contracts.ts` under the pinned mise environment — GREEN: all 12 boundaries.
- `mise run test:unit -- inputs context` — context validation RED on a relative workspace, then
  GREEN: 10 files, 45 tests. Scalar booleans, revisions/issues, repositories, Snapcraft channels
  (including dotted tracks), architecture lists, absolute context paths, run IDs, SHAs, event
  mappings, newlines, duplicates, and size limits are fail-closed.
- `mise run test:contract` — RED: the first long adapter (`call-for-testing`, 46 lines) violated
  the 10–30-line boundary. After moving orchestration into shallow feature-local `action.ts`
  modules, GREEN: 2 files, 2 tests; all twelve adapters are 13 lines and retain exact metadata.

## Phase 2 — Execution boundary

- `mise run test:integration -- runtime` — RED: a timed-out TERM handler exited zero and was
  reported as success, while a token crossing the byte cap leaked its retained prefix. GREEN: 7
  files, 29 tests; timeout/abort override process status (124/130), and bounded capture retains a
  secret-length margin so redaction always happens before final truncation.

- `mise run test:unit -- context` — RED: unsupported GitHub Enterprise/self-hosted/Windows/Ubuntu
  20 contexts reached the missing event file instead of failing the capability boundary. GREEN:
  12 files, 70 tests; github.com, hosted Linux Ubuntu 22.04/24.04, Node 24, repository, run ID,
  commit SHA and event-name constraints are enforced before a bounded regular-file event read.

- `mise run test:integration -- runtime` — RED: 3 failures proved pre-aborted work spawned,
  TERM-resistant descendants outlived the parent until timeout, and secrets remained in bounded
  output.
- `mise run test:integration -- runtime` — GREEN: 2 files, 11 tests; abort-before-spawn,
  TERM→KILL process-group handling, listener cleanup, bounded logs, redaction, both streams,
  timeout, and ownership confinement passed.
- `mise run test:integration -- http runtime` — GREEN: 4 files, 19 tests, including settled log
  write failure cleanup and a real local HTTP server exercising pagination, 429 Retry-After,
  non-retried 401 authorization, response-size rejection, and deadline abort. GitHub read calls use
  bounded injected retry behavior; writes are not generically retried, and every request carries an
  action-cancellation plus explicit HTTP deadline signal.
- `mise run test:unit -- github` — RED: two delayed comments reused the same factory-age timeout
  signal. GREEN with `retry`: 12 files, 83 tests; each individual read or write now receives a
  fresh bounded child signal while retaining the caller cancellation signal.
- `mise run test:unit -- github retry` — GREEN: 12 files, 65 tests; deliberately distinct artifact,
  issue, screenshot, and promotion tokens reached only their intended API clients.

## Inventory correction and Phase 3 project parsing

- `mise run test:contract -- inventory` — RED: the 32-consumer subset had no full inventory
  JSON/source fixtures.
- `mise run inventory` — PASS: paginated 118 public repositories, selected all 87
  non-archived/non-disabled repositories, recursively captured 80 recipe YAML blobs at immutable
  commit/blob SHAs.
- `mise run test:contract -- inventory` — RED: the complete inventory exposed active `i386`
  architecture entries omitted from the initial consumer subset.
- `mise run test:contract -- inventory` — GREEN: 2 files, 2 tests; all 87 repositories and all
  80 exact source blobs verified, with every observed declared schema normalized and all 14 omitted
  declarations rejected in `get-architectures` policy.

## Phase 3 — Manifest collection

- `mise run test:unit -- manifests` — RED: `manifest-arm64` containing
  `manifest-amd64.yaml` was accepted. GREEN with `github`: 14 files, 86 tests; an artifact has one
  exact label-matching YAML entry and manifest architecture. `mise run test:integration -- http`
  GREEN: 5 files, 28 tests, including authenticated streaming artifact downloads rejected from
  Content-Length or accumulated bytes before an oversized ArrayBuffer allocation.

- `mise run test:unit -- manifests` — RED: 3 behavioral failures proved that a wrong snap,
  duplicate architecture record, and missing expected architecture were accepted. Four archive
  safety cases already rejected correctly. An earlier run failed in the test ZIP encoder itself
  and is not counted as behavioral RED evidence.
- `mise run test:unit -- manifests` — GREEN: 8 files, 30 tests; pagination, immutable legacy
  filenames, snap/architecture/revision binding, expired artifacts, duplicate records and
  destinations, traversal/absolute paths, symlinks, and archive limits passed.
- `mise run test:contract` — GREEN: 2 files, 2 tests.
- `mise run test:unit -- project` — RED then GREEN: the active Spelunky-style legacy
  `build-on: amd64` plus `run-on: [amd64, i386]` fixture initially lost the i386 target; 7 files,
  30 tests pass after preserving both normalized build targets.

## Phase 4 — Update, review, and trusted tests

- `mise run test:integration -- workflows` — RED: the pushed subject remained `bump to 1.0`
  after the script wrote version 2.0. GREEN: 5 files, 26 tests; the callback now runs only after a
  successful script and tracked-change/untracked-policy inspection, immediately before commit.
- `mise run test:integration -- workflows` — RED: a safe caller variable was missing from the
  trusted Bash environment. GREEN: 5 files, 27 tests; safe inherited/GitHub variables remain,
  credential and Bash-loader names are removed, bounded redacted output is streamed to the job
  log, and the optional summary is read into a fixed byte allocation before UTF-8 truncation.

- `mise run test:integration -- workflows` — RED: 4 failures proved update/test caller
  cancellation was ignored, the complete log was not returned independently of scratch storage,
  and a removed step-summary file replaced the test result with an `ENOENT` error.
- `mise run test:integration -- workflows` — GREEN: 2 files, 14 tests; real Bash and temporary
  Git repositories covered untracked rejection, multiline early/stderr failure, bounded Markdown
  logs, report failure independence, missing summary no-op, cleanup, cancellation, and argument-array
  review construction.
- `mise run test:integration -- workflows screenshots review` — RED: the controlled `snap` review
  executable could not be found because the workflow discarded its scoped PATH. After wiring that
  dependency, GREEN: 8 files, 31 tests. Real temporary bare Git remotes now prove tracked-only
  modification/deletion sync, no-change behavior, local-commit preservation after rejected push,
  and untracked-only rejection. Controlled `snap`/`sudo`/review and `ghvmctl` executables prove
  hostile values remain argument data and verify success and subprocess-failure paths.
- `mise run test:unit -- review` — GREEN: 15 files, 86 tests; local-build review parses the checked
  out project and forwards classic confinement plus workspace-resolved plug/slot declarations
  before its optional dangerous install.

## Phase 5 — Release and partial publication

- `mise run test:unit -- release` — RED: a revision that existed before upload but was moved onto
  the target channel was downloaded and could be misclassified as the new upload; malformed tag
  identity also reached Git. GREEN: 13 files, 83 tests. Readback baselines every Store revision,
  not only the target channel, and tag identity fails before subprocesses. Explicit regressions
  cover remote-build zero-write failure, publication-before-manifest failure, and tag failure after
  publication/manifest stages.

- Read-only `gh run list`/`gh run view --log` for public run `33880420814` — PASS: immutable
  consumer SHA `8e68f1ac9fed2dd7accd582bf80b81e0b1486bd2`, observed revisions 943/944 and
  `Status: released`. Read-only GitHub code/API inspection of Snapcraft commit
  `de384be8922b27770df948ce1ceb3a61d314f63b` captured the canonical upload message and revisions
  table in `test/fixtures/snapcraft/upload-output.json`.
- `mise run test:unit -- release` — RED: 5 failures proved the generic revision regex accepted an
  unsupported message, adopted versions were rejected, a pre-existing Store revision was not
  differentiated, publication-record errors lost known external state, and project symlinks were
  copied. A later RED proved post-upload readback errors were not stage-aware.
- `mise run test:unit -- release` — RED for the missing Snapcraft parser module, then GREEN: 9
  files, 37 tests. The release suite now covers adopted artifact metadata, literal binding,
  core18/20/22 target restriction versus core24 `--build-for`, configured Snapcraft channel,
  nested staged Git, regular bounded artifacts/components, exact digest/version/architecture
  before/after reconciliation, no blind upload retry, immediate publication journaling, and
  stage-aware failures.

## Phase 6 — Testing issues and screenshot publication

- `mise run test:unit -- testing-issue` — RED: an adopt-info manifest rendered version
  `undefined`. GREEN with `manifests release`: 15 files, 88 tests; backward-compatible manifests
  optionally carry the inspected artifact version, every architecture must agree on one version,
  and Store fallback supplies the exact revision/version pair.

- `mise run test:integration -- screenshots` — RED: hostile application data reached `ghvmctl`
  and capture reused ambient screenshot state without owned VM/file cleanup. GREEN: 7 files, 31
  tests; validated snap/app and exact snap+amd64 manifest binding precede execution, ghvmctl receives
  argument arrays, every run uses a unique VM and fresh owned capture directory, LXD/file cleanup
  runs, and only bounded regular PNG files are returned.

- `mise run test:unit -- testing-issue screenshots` — RED: 3 failures proved screenshot
  repository/date inputs reached blob creation unchecked, comment retry orchestration was absent,
  and the issue body had drifted from the bundled legacy template/placeholders.
- `mise run test:unit -- testing-issue screenshots` — GREEN: 9 files, 39 tests; manifest-bound
  issue rendering and override rejection pass, while two blobs remain one immutable non-force
  commit, confirmed conflicts/readback recover safely, public path fields validate before writes,
  and comment retries cannot repeat the upload.
- `mise run test:unit -- screenshots` — RED: an empty/non-PNG capture was accepted and both blobs
  were written. GREEN with `github retry`: 14 files, 76 tests; input metadata and PNG signatures,
  every returned Git object SHA, success/error ref readback, descendant ancestry, and confirmed
  conflict semantics are checked. Bounded retries use the shared injected clock/random/Retry-After
  policy, while comment retries reuse the single immutable upload.

## Phase 7 — Promotion authorization

- `mise run test:unit -- promotion` — RED: two valid `/promote` lines were unioned and an
  unrelated record could authorize a write. GREEN with `github`: 12 files, 77 tests; the command
  is bound to one open non-PR `testing` issue for the exact repository and snap, edited comments
  and unauthorized actors fail before the eyes reaction, all revisions validate before Store
  writes, Snapcraft uses the configured channel, and successful closure is read back.

- `mise run test:unit -- promotion` — RED: 2 failures proved that issue revision records were not
  channel-bound and a post-release reporting failure erased the known released set.
- `mise run test:unit -- promotion` — GREEN: 8 files, 41 tests; strict event/command grammar,
  permission checks, whole-set revision/channel validation before Store writes, ordered partial
  outcomes, and close-only-after-all-releases-and-report behavior passed.

## Phase 8 — Deterministic packaging

- `mise run test:contract -- packaging` — RED: both tests failed because every production
  adapter contained `SNAPCRAFTERS_CI_SMOKE` and distribution verification launched Bun through
  `process.execPath` while rebuilding twice from one live source tree.
- `mise run test:contract -- packaging` — GREEN: 3 files, 4 tests; the production bypass is
  absent and the verifier requires pinned `node` plus complete independent tracked-source copies.
- `mise run test -- main.test` — GREEN: 12 files, 12 tests; each thin adapter maps to its named
  workflow exactly once without a production-only escape path.
- `mise run test:contract -- packaging` — RED: the computed JSON architecture key did not match
  the preserved wrapper output, promotion lacked checkout, and screenshots did not install
  ghvmctl. GREEN: 3 files, 5 tests; exact internal output wiring and prerequisites pass, and the
  renderer no longer emits a null `env` mapping for input-free actions.

- `mise run build` using pinned Vite+ `vp pack` — deterministic CJS output, but inspection found
  runtime `require()` calls for `@actions/core`, `@actions/github`, `yaml`, and `yauzl`; this failed
  the self-contained consumer criterion and those bundles were not accepted.
- Pinned Bun installed exact `esbuild@0.25.10`; the minimal build script bundles only the explicit
  twelve-entry manifest and derives full dependency licence notices from the actual metafile.
- `mise run build` — PASS for all 12 action-local `dist/index.cjs` plus `licenses.txt` pairs.
- `mise run check-dist` — PASS: two isolated builds matched each other and committed files by SHA-256;
  no non-builtin runtime requires remained; all 12 bundles ran with Node 24 from a disposable
  consumer tree without development dependencies.
- `vp test run --coverage` through pinned mise — initial report was 55.50% aggregate branch
  coverage and was rejected as the wrong gate. A pure-parser gate then found one RED case where a
  YAML sequence was accepted as a manifest mapping. After the fix: 27 files, 91 tests; the measured
  input/manifest/architecture parsers reached 96.66% branch, 96.82% statement, 98.11% line, and
  100% function coverage.
- `mise run test:smoke` — GREEN: 1 file, 1 consumer-simulator test parsed all 12 real composite
  wrappers, admitted only the five approved SHA-pinned external actions, mapped wrapper input
  environments, and executed every wrapper-owned bundle step from a disposable external checkout;
  release-to-candidate exercised both its publish and tag bundle invocations.

## Intentionally unrun external acceptance

No Launchpad remote build, Snap Store upload/release/promotion, GitHub issue/comment/tag/ref write,
or KVM/ghvmctl desktop session was triggered. This is deliberate under the no-external-writes
boundary and supersedes the plan's sandbox/canary definition-of-done for this local child. The
manual integration and release workflows require protected environments and are not reachable from
untrusted pull requests. The parent will independently inspect and push; this child did not push or
create a pull request.
