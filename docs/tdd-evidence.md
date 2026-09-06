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
- `mise run test:unit -- release` — RED: an exact existing local/remote tag was rewritten. GREEN:
  14 files, 88 tests; complete publication state (snap/version/revision/channel/architecture/digest/
  source SHA) is revalidated against the tag phase checkout, exact tags are idempotent, ambiguous
  push results are read back, and Launchpad/Store credentials are absent from the tag subprocess.
- `mise run test:unit -- release` — RED: one empty post-upload Store view immediately failed an
  otherwise bindable adopted-version release. GREEN: 14 files, 88 tests; publication performs
  three bounded, injected-clock readback attempts and never repeats the upload.

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
- Reviewer-directed idempotency regressions (added after the first implementation rather than a
  historical RED) are GREEN in `mise run test:unit -- github testing-issue screenshots promotion`:
  15 files, 94 tests. Deterministic run/source/comment markers recover issue/comment disconnects,
  authorization errors are not retried, and promotion redelivery reads Store state and performs
  zero release writes for revisions already on the destination channel.

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
- `mise run test:smoke` — RED after rebuilding the stale bundles: `get-screenshots` reached its
  real input validation and rejected the empty-string optional application input. A focused
  `mise run test:unit -- inputs` RED then proved Actions-style empty optional values bypassed
  defaults. GREEN after fixing shared input semantics: 1 file, 2 tests. The consumer simulator
  parsed all 12 real composite
  wrappers, admitted only the five approved SHA-pinned external actions, mapped wrapper input
  environments, and executed every wrapper-owned bundle step from a disposable external checkout;
  release-to-candidate exercised both its publish and tag bundle invocations. Its second test runs
  every bundle in an invalid consumer context and verifies there is no production bypass.
- `mise run test:smoke` — RED: the simulator's ambient `node` was 22.22.3. GREEN after resolving
  the exact mise-installed Node executable: every bundle step asserted runtime 24.x before running.
- `mise run test:coverage` with the complete parser/validator list — RED: 140 tests passed, but the
  honest expanded surface was 76.99% branch and 85.23% line coverage. Pure context, project-schema,
  promotion-legacy, Store-output, and screenshot validation were separated into their feature
  folders (not excluded), then exercised with malformed/boundary tables. GREEN: 151 tests across
  35 files; 96.21% branch, 97.74% statement, 99.01% line, and 100% function coverage. Every listed
  module is individually at least 90% branch coverage.
- `mise run test:integration -- workflows` — RED: an oversized multibyte summary lost its
  truncation marker during a second formatting cut. GREEN: UTF-8-safe byte truncation reserves the
  notice; the test result remains independent of summary/report behavior.
- `mise run check-dist` — RED twice: nested mise resolution failed in this sandbox, then the
  verifier incorrectly required `stderr` even though Actions reports failures on `stdout`. GREEN:
  the verifier resolves the exact Node pin from mise's install layout, independently copies every
  tracked source input twice, performs two frozen Bun installs/builds, compares both builds and the
  committed dist by SHA-256, rejects smoke markers/external requires, and executes all 12 copied
  bundles with Node 24.20.0.
- Final `mise run ci` — PASS: formatting, type-aware lint/typecheck (95 source files), 151 tests in
  35 files with the coverage figures above, actionlint, ShellCheck for the standalone helper plus
  all 15 inline Bash steps, and the isolated deterministic 12-bundle check all passed.
- Final authenticated read-only `gh api 'orgs/snapcrafters/repos?per_page=100&type=all'
--paginate --slurp` aggregated with Python — PASS: 2 pages, 118 repositories, 87 active, zero
  private. The committed inventory still covers all 87 and all 80 recursively discovered recipes.
- `git diff --check` and `git diff --check upstream/main...HEAD` — PASS. A path-scoped
  `.gitattributes` rule preserves intentional whitespace in immutable recipe blobs while every
  implementation/generated file remains under normal checks. Source/generated secret-pattern and
  production smoke-marker scans returned no findings; every local branch commit verified `%G?=G`.

## Independent-review closure

- Wrapper regressions for the architecture output key, promotion checkout/Snapcraft channel,
  screenshot ghvmctl setup, and local classic/declaration review all have public-wrapper or adapter
  coverage and observable fake side effects.
- Fresh per-request GitHub deadlines, timeout/abort exit codes, update-message timing, bounded safe
  logs/summaries, adopted versions, streamed artifact limits/label binding, redaction-before-bound,
  and issue/comment/promotion idempotency each have focused unit or local HTTP/process regressions.
- Promotion now binds repository, open non-PR testing state, snap header, source/destination channel,
  exact architecture/revision table, and the single command before any Store write. Store readback
  uses the shared strict Snapcraft table parser.
- Release tests cover a stale source artifact, pre-existing revisions, eventual readback, exact
  digest/version/architecture binding, bounded complete state files, immediate publication records,
  manifest/tag/cleanup partial states, and exact-tag recovery.

## Parent gate regression

- Parent `mise install` and `mise run install` passed without dependency changes.
- Parent `mise run ci` exposed an invalid-context wrapper test timeout at the implicit 5-second
  limit. Giving the twelve sequential Node processes the same explicit 60-second test budget as
  the successful-wrapper case then exposed the actual failure: `setup-ghvmctl` returned zero in an
  invalid consumer context instead of rejecting it before setup commands.
- Added the existing bounded hosted-runner context validation before ghvmctl setup. Rebuilt the
  bundle; `mise run test:smoke` passed both tests. Parent `mise run ci` then passed all 151 tests in
  35 files, the 96.21% pure-parser branch gate, all lint checks and both isolated bundle rebuilds.

## Intentionally unrun external acceptance

No Launchpad remote build, Snap Store upload/release/promotion, GitHub issue/comment/tag/ref write,
or KVM/ghvmctl desktop session was triggered. This is deliberate under the no-external-writes
boundary and supersedes the plan's sandbox/canary definition-of-done for this local child. The
manual integration and release workflows require protected environments and are not reachable from
untrusted pull requests. The parent will independently inspect and push; this child did not push or
create a pull request.

## Final independent-review remediation

- Entrypoint RED: `vp test run test/smoke/wrappers.test.ts -t 'invalid consumer context'`
  failed on the first bundle (`call-for-testing`, exit 0) when the consumer supplied
  `NODE_ENV=test`. GREEN after moving direct execution into the deterministic CJS build footer:
  all 12 bundles rejected the isolated invalid context, with deny-command stubs proving no
  subprocess orchestration occurred. `mise run ci` then passed 151 tests in 35 files, the
  96.21% branch parser gate, all static checks, and two isolated Node 24 bundle rebuilds.
- Store-contract RED: focused manifest/Snapcraft tests failed three ways: revision
  `9007199254740993` decoded as `9007199254740992`, the real four-column unreleased table header
  was rejected, and readback produced no snap because it invoked the fake `snapcraft download`.
  GREEN: 12 focused tests preserve the decimal via BigInt parsing, accept both documented
  Snapcraft 9 table shapes, and require `snap download demo --revision=44`. The strict wrapper fake
  no longer implements `snapcraft download`. Immutable CLI source provenance is recorded under
  `test/fixtures/cli-contracts`. The first full gate correctly failed formatting and then a stale
  optional-tuple type; after both corrections, `mise run ci` passed 154 tests in 35 files,
  96.28% parser branches, all static checks, and both isolated Node 24 rebuilds.
- ghvmctl-alias RED: the integration fake was changed to the immutable ghvmctl 0.4.1 behavior—two
  timestamped PNGs plus relative stable-name symlinks—and capture failed with `Screenshot symlinks
are forbidden`. GREEN: capture accepts only exact same-directory timestamp aliases owned by the
  current UID, opens the resolved file with `O_NOFOLLOW`, and verifies owner/device/inode, size,
  and PNG signature. A traversal alias is rejected. The full gate passed 155 tests in 35 files,
  96.28% parser branches, static checks, and isolated bundle rebuilds.
- Release-resume RED: two action-level tests initially exposed a missing test seam via the hosted
  context boundary; after introducing only an injected context/release seam, the corrected RED
  showed both exact and mismatched state invoking release orchestration once. GREEN: an exact
  architecture/channel/source-SHA state recreates or verifies its bounded manifest and exports the
  original decimal revision without build/upload; stale state fails before release orchestration.
  A separate contract RED proved the publish bundle still received `INPUT_REPO_TOKEN`; GREEN keeps
  that secret only on the pinned checkout step. The full gate passed 157 tests in 36 files,
  96.28% parser branches, static checks, and isolated Node 24 rebuilds.
- Live-output RED: a child printed stdout, then stderr, and blocked; neither injected runner sink
  observed bytes before release, while the old implementation dumped both streams only after
  close. GREEN: incremental UTF-8 decoding holds only possible secret prefixes across chunks,
  redacts before a shared byte bound, and emits in child event order. The regression splits
  `secret` across writes and reaches both sinks before child exit. The full gate passed 158 tests
  in 36 files, 96.28% parser branches, static checks, and isolated Node 24 rebuilds.
- Wrapper-boundary RED: setup-ghvmctl's first step was the sudo udev mutation and the unsupported
  context simulator observed three sudo calls plus two external actions before bundle rejection.
  GREEN: setup-ghvmctl and get-screenshots begin with a Bash-builtin-only hosted-runner guard,
  before checkout/KVM/LXD. A second RED showed all five SHA-pinned `uses:` dependencies absent from
  smoke observations. GREEN: the disposable consumer now simulates and validates checkout, exact
  Node 24 setup, LXD setup, action-build output, and bounded regular-file artifact upload; no
  `uses:` branch is skipped. All side-effect-capable wrapper commands remain isolated fakes. The
  full gate passed 159 tests in 36 files, 17 ShellCheck snippets, no check warnings, deterministic
  rebuilds, and 96.28% parser branches.
- Coverage-surface RED: replacing the ten-file allowlist with `src/**/*.ts` exposed the honest
  shipped-source baseline: 159 tests, 74.33% branches, 77.79% statements, 79.69% functions, and
  79.21% lines; orchestration action modules were at zero. GREEN: action-level success,
  fail-before-write, fail-after-write/auth/cleanup tests plus real setup tests bring 173 tests in
  38 files to 79.86% branches, 87.95% statements, 87.73% functions, and 90.26% lines across every
  shipped source file. The all-source floor is enforced separately from 90% thresholds on every
  pure parser/validator group. No orchestration module is excluded.
- The first widened full gate also reproduced `EDQUOT`: two 600 MiB independent Bun dependency
  trees were installed concurrently in `/tmp`. GREEN retains two clean source-tree rebuilds but
  builds them sequentially and removes each dependency tree after its bundle hashes are captured.
  `mise run ci` then passed all 173 tests/38 files, full-source and pure-parser coverage gates,
  actionlint, 17 ShellCheck snippets, clean type-aware checks, and deterministic Node 24 bundles.
- Setup privilege-boundary RED: the contract test found the first exact bundle invocation at step
  four, after the first `sudo`, and the invalid-context consumer observed three `sudo` calls plus
  LXD setup before the bundle rejected its incomplete Actions context. GREEN adds a side-effect-free
  bundle validation phase immediately after pinned Node 24 setup and before udev/LXD; unsupported
  phases fail closed. The hostile consumer now observes only pinned Node setup and no privileged or
  host setup command. The focused command
  `./node_modules/.bin/vp test run test/contract/actions.test.ts test/smoke/wrappers.test.ts
src/screenshots/setup.test.ts` passed 7 tests in 3 files.
- The first resulting `mise run ci` correctly failed one smoke assertion because setup now invokes
  its bundle twice (preflight and execution) while the harness still required one. After making the
  two invocations explicit, the full gate passed 174 tests in 38 files, 87.98% statements, 79.93%
  branches, 87.73% functions, and 90.27% lines across all shipped source; all pure parser/validator
  90% gates, type-aware checks, actionlint, 17 ShellCheck snippets, and two isolated deterministic
  Node 24 bundle rebuilds also passed.
