# Behavior and recovery

Scripts are trusted caller code. Never run a pull request's scripts with publishing credentials.
Version synchronization lists and rejects every untracked path before committing tracked changes;
identity settings are local to each Git command. Test scripts run unchanged in one private Bash
file with `-e -o pipefail`. Complete stdout/stderr files remain private in the runner temporary
directory. Live output and summaries are bounded and redact known credential values. Caller
step summaries are included within the reporting bound; reporting failures preserve test status.

Manifest artifacts keep the names `manifest-ARCH` / `manifest-ARCH.yaml`. ZIP data is validated
in memory before filesystem writes: exact name, architecture and decimal-string revision,
entry identity, CRC, size and duplicate checks. Call-for-testing checks the complete requested
architecture set. Large revisions never pass through floating-point numeric conversion.

Release uses fresh staging, source-local synthetic Git, exact fresh snap/component metadata and
one Snapcraft upload. It records a baseline before upload and confirms a new exact revision with
active-channel readback and a downloaded snap digest. An ambiguous upload is never retried.
Confirmed state includes snap, relative root, version, revision, architecture, channel, SHA384
and source commit. The state artifact is restored before a workflow rerun can build or upload.
If that artifact was never saved, the rerun fails and requires reconciliation with the Store;
recover the original `.ci-release-ARCH.json` if it remains available. Never delete state to force
another upload. Artifact/tag errors identify the already published revision. Annotated tags are
verified by exact target and message. Multi-snap mode selects one root and prefixes that snap's tag.

The pinned external upload-artifact action has no supplied-token input and uses GitHub's Actions
runtime artifact credential. All REST artifact/issue/comment/tag operations explicitly use their
supplied token. Screenshot repository writes use only the screenshot token. API calls have fresh
abort signals, bounded bodies and pagination. Deterministic markers require exact content matches.

Promotion requires a newly created, unedited comment, current repository write permission and an
open non-PR testing issue. Every requested revision is validated before any Store release. Writes
are sequential; successful revisions are read back and can be replayed idempotently. An unrelated
revision rejects the complete command. Closure requires all requested revisions plus `done`.

Screenshot capture owns its temporary HOME and VM and deletes both during cleanup. It permits only
constrained ghvmctl timestamp aliases to current-UID regular PNGs, opened without following target
symlinks. Two blobs are committed in one tree/commit, with a non-force ref update and immutable URLs.
Only an explicit non-fast-forward response plus a changed ref is retryable. Comment retry uses the
saved `.ci-screenshots-KEY.json`; absent saved state on a new runner fails before another upload.

Limits: at most 1,000 paginated items; 8 MiB JSON responses; 1 MiB manifest ZIPs and 64 KiB entries;
8 MiB per PNG; three publication readbacks/ref-conflict attempts. Runner/provider failures can
leave confirmed external work behind. The offline checks do not establish live Store, Launchpad,
KVM or GitHub write compatibility. Protected canary verification remains a rollout step.
