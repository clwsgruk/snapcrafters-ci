# snapcrafters/ci/run-tests

Runs tests on a snap deployed from a specified channel and logs the result to the provided issue. If the given test command writes any markdown to the file in the environment variable `$GITHUB_STEP_SUMMARY`, that will be included in the resulting comment. See [the GitHub workflows documentation](https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#adding-a-job-summary) for more info.

## Usage

Replace `REVIEWED_SHA` with a reviewed immutable action commit. See
[behavior and recovery](../docs/operations.md) for supported runners and corrections.

```yaml
# ...
jobs:
  test:
    name: 🗒️ Test snap
    needs: call-for-testing
    runs-on: ubuntu-24.04
    steps:
      - name: 🗒️ Run tests
        uses: snapcrafters/ci/run-tests@REVIEWED_SHA
        with:
          issue-number: ${{ needs.call-for-testing.outputs.issue-number }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          test-script: |
            echo "The first 100 and last 100 lines of output will be included in a comment on the call for testing."
```

## API

### Inputs

| Key                      | Description                                                                                                                       | Required | Default            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | :------: | :----------------- |
| `issue-number`           | The issue number to post the result to.                                                                                           |    Y     |                    |
| `channel`                | The channel to create the call for testing for.                                                                                   |    N     | `latest/candidate` |
| `github-token`           | A token with permissions to common on issues in the repository.                                                                   |    Y     |                    |
| `snapcraft-project-root` | The root of the snapcraft project, where the `snapcraft` command would usually be executed from. Do not include the trailing `/`. |    N     |                    |
| `test-script`            | The script containing the tests.                                                                                                  |    Y     |                    |
