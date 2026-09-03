# ChefVoice PWA 0.8 — Hands-Free + Production Polish

This release builds on the known-good iPhone Media Isolation v0.7.3 baseline.

## Intentionally unchanged
- iPhone hard media reset before Cook & Capture
- exact physical camera selection / camera picker
- two-way WebRTC Live
- deterministic ingredient parser
- independent original session audio
- Firebase schema and security rules

## New hands-free commands
Commands are only interpreted when the chef explicitly says `ChefVoice` or `Chef Voice`.

Examples:
- `ChefVoice, new step: simmer for ten minutes`
- `ChefVoice, new step` then speak the next step
- `ChefVoice, add a note: this needs more salt next time`
- `ChefVoice, mark that optional`
- `ChefVoice, correction: make that three cups`

Command phrases are not dumped into the normal recipe transcript.
Corrections are converted into the deterministic parser's existing correction language.

## Production UI cleanup
- iPhone speech diagnostics are hidden by default.
- A `Show voice troubleshooting` control reveals them when needed.
- Hands-free commands are discoverable in a collapsible help section.
- Proven v0.7.3 media workarounds remain active underneath.

## Next candidates
- offline cloud sync queue and idempotent retry
- shared Android/Web golden cooking-language corpus
- server-side second-pass transcription for uncertain iPhone speech
- App Check / moderation / authoritative social counters
