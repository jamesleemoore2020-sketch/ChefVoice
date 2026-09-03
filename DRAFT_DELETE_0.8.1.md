# ChefVoice PWA 0.8.1 — Delete Current Draft

## Added
- A visible `Delete draft` action at the bottom of Cook & Capture.
- Confirmation before destructive deletion.
- If capture is currently recording, ChefVoice stops the recording before deletion.
- Deletes only the unsaved current working draft. Saved/local library recipes and published Community recipes are not deleted.

## The delete action clears
- recipe title/description/servings draft
- ingredients and steps
- transcript and current partial speech
- selected local photos/video and their temporary object URLs
- current recorded audio blob
- IndexedDB crash-recovery checkpoint
- checkpointed recovery audio chunks
- pending iPhone refresh/session recovery state
- hands-free command state and capture UI state

## Protected
- v0.7.3 iPhone media-isolation behavior remains in place.
- deterministic ingredient parser remains in place.
- Firebase schema/rules are unchanged.
- Android native app is unchanged.
