# snapcrafters/ci/fetch-manifests

This action is more for use internally than otherwise. It's purpose is to download all and unpack
all artifacts containing build manifests from the `snapcrafters/ci/release-to-candidate` workflow.

## Usage

Replace `REVIEWED_SHA` with a reviewed immutable action commit. See
[behavior and recovery](../docs/operations.md) for supported runners and corrections.

```yaml
# ...
jobs:
  fetch-manifests:
    name: 📦 Fetch workflow manifests
    runs-on: ubuntu-24.04
    steps:
      - name: Fetch artifacts
        uses: snapcrafters/ci/fetch-manifests@REVIEWED_SHA
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
```

## API

### Inputs

| Key     | Description                                                        | Required | Default |
| ------- | ------------------------------------------------------------------ | :------: | :------ |
| `token` | A token with permissions to download artifacts for the repository. |    Y     |         |

### Outputs

None
