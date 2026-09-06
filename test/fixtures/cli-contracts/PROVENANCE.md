# CLI fixture provenance

These contracts are tied to immutable upstream source, not invented command shapes.

- Snapcraft 9.0.1 resolves to commit `68c28110f50f9933b4d19f13bf7cb69ddf1e4391`.
  `snapcraft/commands/status.py` lines 482–515 emit five columns when releases exist and four
  columns when they do not. The four-column test row uses the exact `tabulate(...,
tablefmt="plain")` layout with bounded synthetic values; only the field values are synthetic.
- snapd 2.76.3 resolves to commit `58163ecc3eae8d0581d893934115eb354d85f85e`.
  Installed `snap download --help` confirms `snap download <snap> --revision=<revision>` and the
  default `<snap>_<revision>.snap` output in the current directory. Strict fakes accept this command
  and reject `snapcraft download`.
- ghvmctl 0.4.1 revision 16 source commit `4a75002b2a547097fcdddcb670925e0a9932325f`
  creates timestamped screenshot PNGs and replaces
  `screenshot-screen.png` and `screenshot-window.png` with relative symlinks to those files. The
  screenshot simulator reproduces that alias behavior.
