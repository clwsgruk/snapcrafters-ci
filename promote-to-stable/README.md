# snapcrafters/ci/promote-to-stable

Promote to stable is generally triggered in response to a Snapcrafters reviewer posting a comment
containing a `/promote` command. Once the arguments are successfully parsed, the specified
revisions are promoted to the specified channel (`latest/stable`) by default.

## Usage

Replace `REVIEWED_SHA` with a reviewed immutable action commit. See
[behavior and recovery](../docs/operations.md) for supported runners and corrections.

Use the complete, serialized [publishing examples](../docs/publishing.md).

## API

### Inputs

| Key                      | Description                                                                                                                       | Required | Default         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | :------: | :-------------- |
| `channel`                | The channel to promote the snap to.                                                                                               |    N     | `latest/stable` |
| `github-token`           | A token with permissions to write issues on the repository                                                                        |    Y     |                 |
| `store-token`            | A token with permissions to upload and release to the specified channel in the Snap Store                                         |    Y     |                 |
| `snapcraft-channel`      | The channel to install Snapcraft from.                                                                                            |    N     | `latest/stable` |
| `snapcraft-project-root` | The root of the snapcraft project, where the `snapcraft` command would usually be executed from. Do not include the trailing `/`. |    N     |

### Outputs

None
