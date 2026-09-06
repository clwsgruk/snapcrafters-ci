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

## Phase 2 — Execution boundary

- `mise run test:integration -- runtime` — RED: 3 failures proved pre-aborted work spawned,
  TERM-resistant descendants outlived the parent until timeout, and secrets remained in bounded
  output.
- `mise run test:integration -- runtime` — GREEN: 2 files, 11 tests; abort-before-spawn,
  TERM→KILL process-group handling, listener cleanup, bounded logs, redaction, both streams,
  timeout, and ownership confinement passed.

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

- `mise run test:unit -- manifests` — RED: 3 behavioral failures proved that a wrong snap,
  duplicate architecture record, and missing expected architecture were accepted. Four archive
  safety cases already rejected correctly. An earlier run failed in the test ZIP encoder itself
  and is not counted as behavioral RED evidence.
- `mise run test:unit -- manifests` — GREEN: 8 files, 30 tests; pagination, immutable legacy
  filenames, snap/architecture/revision binding, expired artifacts, duplicate records and
  destinations, traversal/absolute paths, symlinks, and archive limits passed.
- `mise run test:contract` — GREEN: 2 files, 2 tests.
