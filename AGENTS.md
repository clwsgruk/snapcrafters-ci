# AGENTS.md

## Scope

This repository contains twelve public composite GitHub Actions. Preserve every action directory and its published metadata contract unless a deliberate compatibility change is approved.

## Toolchain

Use mise as the only documented entry point. JavaScript dependencies are managed with Bun; do not introduce npm, pnpm, Yarn, Make, ESLint, or Prettier.

Initial setup:

```sh
mise install
mise run install
mise run hooks:install
```

## Pre-commit hooks

The repository uses the mise-pinned `prek` version and `.pre-commit-config.yaml`.

Every commit runs these repository-wide hooks in order:

1. `mise run fmt` formats maintained files using the Prism-guided Oxfmt configuration.
2. `mise run build` regenerates every committed `*/dist/index.cjs` bundle and licence notice.
3. `mise run check` verifies formatting, lint rules, and TypeScript types.
4. `mise run size` enforces the production, tooling, test, fixture, and file-count budgets.

The bundle hook is intentionally `always_run` and receives no filenames. If formatting or generation changes files, the commit must stop: inspect and stage the source and matching generated artifacts, then commit again. Do not bypass or skip the bundle hook to land stale `dist` files.

Run all hooks manually with:

```sh
mise run hooks:run
```

## Tests and generated artifacts

Feature tests are colocated as `src/<feature>.test.ts`; the size-gate test is `scripts/size.test.ts`. Shared harnesses and immutable fixtures live under `test-support/`.

Generated action artifacts are committed because consumers execute them directly. Never edit `*/dist/*` by hand. Change source, run `mise run build`, and commit source and generated artifacts together.

Before pushing, run:

```sh
mise run ci
git diff --check
```

`mise run ci` is the authoritative full gate: formatting/lint/types, tests and coverage, actionlint, ShellCheck, size limits, bundle generation, and two independent frozen build comparisons under Node 24.

## Git

Use small signed conventional commits. Push implementation branches only; do not open a pull request unless explicitly requested.

## Safety

Never run live Snap Store, Launchpad, GitHub write-API, or KVM/ghvmctl acceptance operations without explicit approval. Tests must use local servers, temporary Git repositories, and deny-by-default fake executables.
