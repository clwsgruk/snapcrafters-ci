# snapcrafters/ci/fetch-manifests

This action is more for use internally than otherwise. It's purpose is to download all and unpack
all artifacts containing build manifests from the `snapcrafters/ci/release-to-candidate` workflow.

Artifact listing is paginated. Archives are validated and isolated before extraction; expired,
oversized, nested, absolute, symlinked, duplicate, or conflicting manifests fail closed.

## Usage

```yaml
# ...
jobs:
  fetch-manifests:
    name: 📦 Fetch workflow manifests
    runs-on: ubuntu-latest
    steps:
      - name: Fetch artifacts
        uses: snapcrafters/ci/fetch-manifests@<immutable-commit-sha>
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
