# TDD evidence

The repository pins Node 24.20.0 and Bun 1.4.0 through mise. Early test commands
were later found to resolve Node 22.22.3 through a higher-priority host PATH entry.
The copied-wrapper test exposed this (12 failures: Node 24 required); task commands now
invoke mise's resolved Node binary explicitly. Final checks rerun the full suite on Node 24.
The container's snap launcher fails; a temporary launcher invokes the same mise binary directly,
with its state in /tmp and unrelated global tool configuration excluded.

- `mise run test` — RED: budget test could not import `scripts/size.ts` (module absent).
  Added a nonblank-line/file counter and hard-cap checks. Metadata snapshots capture all twelve
  original blocks verbatim, including output expressions.

- GREEN: `mise run check` passed; `mise run test` passed 2 tests.

- `mise run test -- test/project.test.ts` — RED: absent project module; GREEN: nested path,
  last-match precedence, declarations and component serialization passed.
- Same command — RED: `architectures is not a function`; added normalization driven by the
  fresh inventory (87 repositories, 80 recipes, 38 compact shapes), plus list/label/ambiguity cases.
- `mise run test -- test/runtime.test.ts` — RED: absent runtime module. Added hosted-runner/Node
  validation and the first two public adapters; wrappers own their internal phase.

- GREEN: 5 tests passed; build succeeded for both migrated actions.

- `mise run test -- test/execution.test.ts` — RED: absent execution module; GREEN: one Bash
  process preserved script/streams/status and excluded credentials. Second RED: absent sync
  module; GREEN: real Git/bare remote rejects untracked paths without commit and pushes the
  post-script version message.
- `mise run test -- test/runtime.test.ts` — RED: setup-ghvmctl first step had no validation
  phase. Moved validation before sudo/LXD, pinned ghvmctl revision 16, final phase explicitly run.

- GREEN: 8 tests passed; all five current adapters built.

- `mise run test -- test/github.test.ts` — RED: absent API module; GREEN: explicit token,
  authentication failure, and disconnect-after-comment-write recovered without duplicate.
- `mise run test -- test/manifests.test.ts` — RED: absent manifest module. Added bounded
  in-memory ZIP extraction and exact bigint-backed revision parsing. Added collection checks
  for complete expected-set rejection before filesystem writes (these are additional checks,
  not claimed as historical RED).

- GREEN: 11 tests passed and six action bundles built.

- `mise run test -- test/release.test.ts` — RED: absent revisions parser; GREEN: real four/five
  column formats. Second RED: `publish is not a function`; implemented fresh staging and exact
  publication readback. The first implementation run exposed an incorrectly unquoted version
  in the synthetic snap metadata fixture; corrected it to Snapcraft's string form. GREEN:
  exactly one upload/build, digest confirmation and pre-build state replay passed.
- Same command — RED: `tagRelease is not a function`; GREEN: lost ref-write response recovered,
  annotated tag readback verified, replay made no further writes.

- GREEN: 14 tests passed; eight public adapters built.

- `mise run test -- test/testing.test.ts` — RED: absent testing module; GREEN: exact table,
  repository, snap/channel binding and caller instruction substitution.
- `mise run test -- test/promotion.test.ts` — RED: absent whole-command parser; GREEN: strict
  command grammar. Second RED: `promote is not a function`; added fresh permission/comment/issue
  checks and prevalidation of the complete requested revision set before sequential releases.

- GREEN: 17 tests passed; eleven adapters built.

- `mise run test -- test/screenshots.test.ts` — RED: absent PNG reader. Corrected the initial
  synthetic timestamp to ghvmctl's inspected `%Y-%m-%d_%H%M%S` spelling before implementation;
  GREEN: constrained alias and no-follow owned regular-file reads.
- Same command — RED: `uploadScreenshots is not a function` for six cases; GREEN: two blobs,
  atomic tree/commit, immutable URLs, successful/lost-response readback, conflict-only retries,
  retry exhaustion, 403 and unrelated 422 rejection.
- Same command — RED: `capture is not a function`; added owned HOME/VM cleanup using actual
  ghvmctl verbs and `lxc delete --force`, with a deny-by-default fake PATH.

- GREEN: 25 tests passed; all twelve adapters built. Size: production 1,650, tooling 89,
  tests 788, fixtures 875 nonblank lines.

- `mise run test -- test/smoke.test.ts` — RED: missing copied-wrapper harness; then RED:
  twelve wrappers rejected accidental Node 22 resolution. Corrected the task executable paths.

- Copied-wrapper GREEN: all twelve public YAML wrappers plus deny-by-default invalid-host setup
  passed on actual Node 24.20.0. An explicit `.cjs` fake executable target was needed because the
  test-only network preload makes Node reject the `.snap-review` filename extension.
- Coverage GREEN: 51 tests; project branches 96.92%, validation branches 90%. Overall source
  branches 66.84%; copied-bundle executions are exercised separately, not credited to that total.
- `mise run test -- test/release.test.ts test/execution.test.ts` — RED: staging dropped needed
  `requirements.txt`, and caller step-summary text was absent. GREEN: preserved source text files
  and bounded/redacted caller summaries while preserving exit 7.
- `mise run test -- test/github.test.ts` — RED: a different body carrying the same marker was
  accepted. GREEN: marker recovery requires exact body/title identity.
- `mise run test -- test/screenshots.test.ts` — RED: unrelated 422 plus concurrent ref movement
  created a second commit. GREEN: retry also requires the explicit non-fast-forward error.
