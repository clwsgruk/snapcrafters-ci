# Snapcrafters CI

This repository contains the twelve reusable actions used throughout the Snapcrafters
[organisation](https://github.com/snapcrafters) for testing and delivering snaps. Each action is
a self-contained Node 24 bundle; consumers do not install JavaScript dependencies at runtime.

## Snapcrafters Actions

The actions in this repo are all used during the build, test and release of our snaps. Each of them listed below has it's own README

- [snapcrafters/ci/call-for-testing](call-for-testing/README.md)
- [snapcrafters/ci/fetch-manifests](fetch-manifests/README.md)
- [snapcrafters/ci/get-architectures](get-architectures/README.md)
- [snapcrafters/ci/get-screenshots](get-screenshots/README.md)
- [snapcrafters/ci/parse-snapcraft-yaml](parse-snapcraft-yaml/README.md)
- [snapcrafters/ci/promote-to-stable](promote-to-stable/README.md)
- [snapcrafters/ci/release-to-candidate](release-to-candidate/README.md)
- [snapcrafters/ci/review-snap](review-snap/README.md)
- [snapcrafters/ci/run-tests](run-tests/README.md)
- [snapcrafters/ci/setup-ghvmctl](setup-ghvmctl/README.md)
- [snapcrafters/ci/sync-version](sync-version/README.md)
- [snapcrafters/ci/test-snap-build](test-snap-build/README.md)

### Usage

Pin the complete action suite to a reviewed immutable commit SHA. Do not use `@main` in production
workflows. Publishing jobs must serialize each snap/channel pair with `cancel-in-progress: false`;
see [release-to-candidate](release-to-candidate/README.md) for an example.

You can see examples of these actions in use in the following repos:

- [signal-desktop](https://github.com/snapcrafters/signal-desktop/tree/candidate/.github/workflows)
- [mattermost-desktop](https://github.com/snapcrafters/mattermost-desktop/tree/candidate/.github/workflows)
- [discord](https://github.com/snapcrafters/discord/tree/candidate/.github/workflows)

## Contributing

If you'd like to contribute to this repository, please feel free to fork and create a pull request.

Install the pinned toolchain with `mise install`, install the locked dependencies with
`mise run install`, and run the same gate as CI with `mise run ci`. Bun is the only JavaScript
package manager; Vite+ provides formatting, linting, type-checking, and tests.

There are a few style guidelines to keep in mind:

- Run `mise run fmt` before committing and `mise run ci` before review.
- When defining inputs/outputs in `action.yaml`, or listing them in the tables within `README.md`, they should be listed in alphabetical order for easy reading and updating.
- Github Action inputs/outputs should be named all lowercase, separated by `-` where needed. The applies to inputs/outputs to actions themselves, and for individual steps within the actions. For example: `snap-name` or `token`.
- Environment variables referring to repository level secrets and variables should be named all uppercase, and separated by `_`. For example: `SNAPCRAFTERS_BOT_COMMIT`.
- Step/job level environment variables should be named all lowercase, and separated by `_`. For example: `snap_name` or `yaml_path`.
- All `bash` variables should be quoted.
- Scripts of all kinds, including those within actions `run:|` directives should follow the [Google styleguide](https://google.github.io/styleguide/shellguide.html)

## Migration and rollback

The TypeScript implementation preserves all twelve public metadata contracts and legacy output
encodings. The deliberate corrections are documented in the action READMEs. Canary by changing a
consumer to an immutable reimplementation SHA and use read-only shadow comparisons before enabling
publishing. Roll back by pinning the consumer to its previous known-good SHA.

Rollback cannot undo Store releases, Git tags, issue comments, or screenshot commits. Reconcile
those external effects explicitly; never delete or re-upload a Store revision just to make a run
green. Live Launchpad, Store, GitHub-write, and KVM canary acceptance is intentionally not run by
the local/PR gate and requires the protected environment-approved workflow.
