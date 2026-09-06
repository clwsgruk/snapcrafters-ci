# Publishing examples

Replace `REVIEWED_SHA` with the reviewed immutable commit of this implementation before use.
Use a protected environment and serialize jobs per snap/channel, including all architectures.
Build pull requests separately with read-only permissions and no publishing secrets.

```yaml
name: Publish sample
on: workflow_dispatch
permissions:
  contents: write
  actions: read
concurrency:
  group: publish-sample-latest-candidate
  cancel-in-progress: false
jobs:
  release:
    environment: snap-publishing
    runs-on: ubuntu-24.04
    steps:
      - uses: snapcrafters/ci/release-to-candidate@REVIEWED_SHA
        with:
          architecture: amd64
          channel: latest/candidate
          repo-token: ${{ secrets.REPO_TOKEN }}
          launchpad-token: ${{ secrets.LAUNCHPAD_TOKEN }}
          store-token: ${{ secrets.STORE_TOKEN }}
```

```yaml
name: Promote sample
on:
  issue_comment:
    types: [created]
permissions:
  contents: read
  issues: write
concurrency:
  group: publish-sample-latest-stable
  cancel-in-progress: false
jobs:
  promote:
    if: ${{ !github.event.issue.pull_request }}
    environment: snap-publishing
    runs-on: ubuntu-24.04
    steps:
      - uses: snapcrafters/ci/promote-to-stable@REVIEWED_SHA
        with:
          channel: latest/stable
          github-token: ${{ secrets.ISSUE_TOKEN }}
          store-token: ${{ secrets.STORE_TOKEN }}
```

The promotion wrapper checks out the repository's trusted default branch. Do not change this
example to check out a pull request's head or execute commenter-supplied code with secrets.
