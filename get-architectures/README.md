# snapcrafters/ci/get-architectures

Parses a `snapcraft.yaml` and returns the list of architectures supported both as a JSON array, and
a space-separated string.

The action supports the architecture/platform forms captured in the immutable active-recipe
inventory. A recipe omitting both fields, or using an unknown/ambiguous form, fails in this action.

## Usage

```yaml
# ...
jobs:
  get-architectures:
    name: 🖥 Get snap architectures
    runs-on: ubuntu-latest
    outputs:
      architectures: ${{ steps.get-architectures.outputs.architectures }}
      architectures-list: ${{ steps.get-architectures.outputs.architectures-list }}
    steps:
      - name: 🖥 Get snap architectures
        id: get-architectures
        uses: snapcrafters/ci/get-architectures@<immutable-commit-sha>
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
