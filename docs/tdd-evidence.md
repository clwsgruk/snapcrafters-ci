# TDD evidence

Commands run with repository-pinned Node 24.20.0 and Bun 1.4.0 through mise.
The container's snap launcher fails; a temporary launcher invokes the same mise binary directly,
with its state in /tmp and unrelated global tool configuration excluded.

- `mise run test` — RED: budget test could not import `scripts/size.ts` (module absent).
  Added a nonblank-line/file counter and hard-cap checks. Metadata snapshots capture all twelve
  original blocks verbatim, including output expressions.

- GREEN: `mise run check` passed; `mise run test` passed 2 tests.
