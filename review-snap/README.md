# snapcrafters/ci/review-snap

Reviews a built snap package using the same [review-tools] used by the Snap Store. This is a
composite action replacement for [diddlesnaps/snapcraft-review-action], which is no longer
maintained.

If you need to specify plug or slot declarations per the [review-tools] README, you can pass them
using the `plugs` and `slots` inputs.

## Usage

Replace `REVIEWED_SHA` with a reviewed immutable action commit. See
[behavior and recovery](../docs/operations.md) for supported runners and corrections.

```yaml
# ...
jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - name: Review the built snap
        uses: snapcrafters/ci/review-snap@REVIEWED_SHA
        with:
          snap: my-snap.snap
```

## API

### Inputs

| Key          | Description                                                         | Required | Default |
| ------------ | ------------------------------------------------------------------- | :------: | :------ |
| `is-classic` | Set this to `true` if you are reviewing a classic snap              |    N     |         |
| `plugs`      | The file holding plugs declarations as json to override permissions |    N     |         |
| `slots`      | The file holding slots declarations as json to override permissions |    N     |         |
| `snap`       | The snap file to review                                             |    Y     |         |

### Outputs

None

[review-tools]: https://snapcraft.io/review-tools
[diddlesnaps/snapcraft-review-action]: https://github.com/diddlesnaps/snapcraft-review-action
