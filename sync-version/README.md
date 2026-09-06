# snapcrafters/ci/sync-version

Takes an `update-script` input which should be a script that automatically checks for version
updates to the upstream application, and modifies the `snapcraft.yaml` as appropriate. This action
takes care of identifying and committing those changes.

`update-script` is intentionally trusted Bash. Tracked modifications and deletions are committed;
any untracked path is listed and fails before commit. The action never uses `git add -A`, and Git
identity is set only for its local commit command.

## Usage

```yaml
jobs:
  sync:
    name: 🔄 Sync version with upstream
    runs-on: ubuntu-latest
    steps:
      - name: 🔄 Sync version with upstream
        uses: snapcrafters/ci/sync-version@<immutable-commit-sha>
        with:
          token: ${{ secrets.TOKEN }}
          update-script: |
            VERSION=$(
                curl -sL https://api.github.com/repos/jnsgruk/gosherve/releases | 
                jq .  | grep tag_name | grep -v beta | head -n 1 | cut -d'"' -f4 | tr -d 'v'
            )
            sed -i 's/^\(version: \).*$/\1'"$VERSION"'/' snap/snapcraft.yaml
```

## API

### Inputs

| Key                      | Description                                                                                                                       | Required |          Default           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | -------- | :------------------------: |
| `bot-email`              | The email address of the bot account used to commit screenshots.                                                                  | N        | `snapforge.team@gmail.com` |
| `bot-name`               | The name of the bot account used to commit screenshots..                                                                          | N        |     `Snapcrafters Bot`     |
| `branch`                 | The branch on which modifications to snapcraft.yaml should be made.                                                               | N        |        `candidate`         |
| `snapcraft-project-root` | The root of the snapcraft project, where the `snapcraft` command would usually be executed from. Do not include the trailing `/`. | N        |                            |
| `token`                  | A token with permissions to commit to the repository.                                                                             | Y        |                            |
| `update-script`          | A script that checks for version updates and updates `snapcraft.yaml` and other files if required.                                | Y        |                            |

### Outputs

None
