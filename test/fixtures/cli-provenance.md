# CLI provenance

Inspected read-only on 2026-09-06. Synthetic test values use these real command/output shapes.

- Snapcraft 9.0.1, commit `68c28110f50f9933b4d19f13bf7cb69ddf1e4391`,
  `snapcraft/commands/status.py:482–550`: `snapcraft revisions SNAP --arch ARCH`, four columns
  before any releases, five thereafter; active channels have a trailing `*`.
  `snapcraft/commands/upload.py:154`: `Revision REV created for SNAP`; component pairs use
  `--component NAME=FILE`. Removed aliases are not used.
- snapd 2.76.3, commit `58163ecc3eae8d0581d893934115eb354d85f85e`: `snap download SNAP
  --revision=REV` produces `SNAP_REV.snap`, as captured in the prior branch's help provenance.
- ghvmctl 0.4.1 revision 16, commit `4a75002b2a547097fcdddcb670925e0a9932325f`,
  `src/ghvmctl`: `VM_NAME`, `SNAP_REAL_HOME`; `prepare`, `snap-install`, `snap-run`, `exec`,
  `screenshot-full`, `screenshot-window`. Timestamped PNGs live in `ghvmctl-screenshots` with
  relative `screenshot-screen.png`/`screenshot-window.png` aliases. No invented cleanup verb.
- GitHub upload-artifact `b7c566a772e6b6bfb58ed0dc250532a479d7789f/action.yml` has no
  supplied-token input; this pinned external action authenticates with the Actions runtime
  artifact credential. REST artifact reads explicitly use the caller's token.
