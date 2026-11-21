# Coordinator transcription merge

Branch: `codex/merge-coordinator-stt`. Work stays in the existing project directory.
The previous local refactor is checkpointed at `fb5d7f5`.

Selected upstream sources:

- PR #23: `b6486aa` adds local whisper-server; `a3810b8` avoids the extra language pass when the phone pins its language.
- PR #26: `ab6bb76` restores audio transport from the phone. This merge uses coordinator transcription without restoring phone mode/model controls.

The daily commands remain Build, Start and Stop. The merge adds host-model preparation,
Whisper lifecycle/readiness and orphan cleanup, while retaining host discovery and automatic
newest-mission joining. Whisper uses 3118; the private controller moves to 3116.

Unrelated remote main changes (command-post UI, resolver, extraction prompt and eval data)
are excluded. This is a selective functional integration, not a merge of all remote main.
No upstream extraction prompt is changed or evaluated as part of this task.

Local transcription needs whisper.cpp’s whisper-server, ffmpeg and about 575 MB of pinned
host models. They are not installed or downloaded without approval. Focused provider and
start/stop checks use stubs; a live phone-to-coordinator microphone check follows setup.
