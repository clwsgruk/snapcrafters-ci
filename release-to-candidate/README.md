# snapcrafters/ci/release-to-candidate

This action is used to run `snapcraft remote-build` for a given Snap, and a given architecture.
Following that, the snap is released to the specified channel automatically.

Each architecture job builds from fresh nested-project staging and reconciles one Snapcraft upload
against before/after Store readback using name, version, architecture, and artifact digest. Adopted
versions come from built snap metadata. Known publication is recorded before manifest/tag work;
upload itself is never blindly retried.

## Usage

```yaml
# ...
jobs:
  release:
    name: 🚢 Release to latest/candidate
    runs-on: ubuntu-latest
    concurrency:
      group: ${{ github.repository }}-latest-candidate
      cancel-in-progress: false
    steps:
      - name: 🚢 Release to latest/candidate
        uses: snapcrafters/ci/release-to-candidate@<immutable-commit-sha>
        with:
          architecture: arm64
          launchpad-token: ${{ secrets.LAUNCHPAD_TOKEN }}
          store-token: ${{ secrets.STORE_TOKEN }}
```

## API

### Inputs

| Key                      | Description                                                                               | Required | Default                    |
| ------------------------ | ----------------------------------------------------------------------------------------- | :------: | :------------------------- |
| `architecture`           | The architecture for which to build the snap.                                             |    N     | `amd64`                    |
| `bot-email`              | The email address of the bot account to use to create and push tags to the repository.    |    N     | `snapforge.team@gmail.com` |
| `bot-name`               | The name of the bot account to use to create and push tags to the repository.             |    N     | `Snapcrafters Bot`         |
| `channel`                | The channel to release the snap to.                                                       |    N     | `latest/candidate`         |
| `launchpad-token`        | A token with permissions to create Launchpad remote builds.                               |    Y     |                            |
| `multi-snap`             | Whether the repo contains the source for multiple snaps.                                  |    N     | `false`                    |
| `repo-token`             | A token with privileges to create and push tags to the repository.                        |    Y     |
| `snapcraft-project-root` | The path to the Snapcraft YAML file.                                                      |    N     |                            |
| `snapcraft-channel`      | The channel to install Snapcraft from.                                                    |    N     | `latest/stable`            |
| `store-token`            | A token with permissions to upload and release to the specified channel in the Snap Store |    Y     |                            |

### Outputs

| Key        | Description                               | Example |
| ---------- | ----------------------------------------- | ------- |
| `revision` | The Snap Store revision that was created. | `15`    |
