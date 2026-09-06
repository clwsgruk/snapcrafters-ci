# snapcrafters/ci/get-architectures

Parses a `snapcraft.yaml` and returns the list of architectures supported both as a JSON array, and
a space-separated string.

## Usage

Replace `REVIEWED_SHA` with a reviewed immutable action commit. See
[behavior and recovery](../docs/operations.md) for supported runners and corrections.

```yaml
# ...
jobs:
  get-architectures:
    name: 🖥 Get snap architectures
    runs-on: ubuntu-24.04
    outputs:
      architectures: ${{ steps.get-architectures.outputs.architectures }}
      architectures-list: ${{ steps.get-architectures.outputs.architectures-list }}
    steps:
      - name: 🖥 Get snap architectures
        id: get-architectures
        uses: snapcrafters/ci/get-architectures@REVIEWED_SHA
```

## API

### Inputs

| Key                      | Description                                                                                                                       | Required | Default |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | :------: | :------ |
| `snapcraft-project-root` | The root of the snapcraft project, where the `snapcraft` command would usually be executed from. Do not include the trailing `/`. |    N     |         |

### Outputs

| Key                  | Description                                                    | Example              |
| -------------------- | -------------------------------------------------------------- | -------------------- |
| `architectures`      | A space-separated list of architectures supported by the snap. | `amd64 arm64`        |
| `architectures-list` | A JSON list of architectures supported by the snap             | `["amd64", "arm64"]` |
