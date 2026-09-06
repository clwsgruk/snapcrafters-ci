# snapcrafters/ci/run-tests

Runs tests on a snap deployed from a specified channel and logs the result to the provided issue.
`test-script` is intentionally trusted Bash. It is written unchanged to a private temporary file
and run with `bash --noprofile --norc -e -o pipefail`; both streams and the complete multiline
status are captured in a bounded private log. Missing or empty summaries are no-ops, and
summary/comment failures do not replace the test result.

## Usage

```yaml
# ...
jobs:
  test:
    name: 🗒️ Test snap
    needs: call-for-testing
    runs-on: ubuntu-latest
    steps:
      - name: 🗒️ Run tests
        uses: snapcrafters/ci/run-tests@<immutable-commit-sha>
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
