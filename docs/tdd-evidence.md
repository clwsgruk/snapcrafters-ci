# TDD evidence

Commands in this file were run from `/home/jon/snapcrafters-ci-reimplementation` on
2026-09-06. External write-enabled acceptance is intentionally excluded.

## Inventory prerequisite

- `gh auth status` — PASS, authenticated as `clwsgruk`.
- `gh api 'orgs/snapcrafters/repos?per_page=100&type=public' --paginate --jq ...` — PASS,
  118 repositories across all pages.
- GitHub code search plus one immutable recursive-tree and blob read per active repository —
  PASS, 32 non-archived repositories, 35 recipe blobs.

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
