# ChefVoice Android v0.9.4 — Navigation, Live Safety, Reliable Recipe Delete

- Android system Back unwinds ChefVoice detail screens and tab history before allowing app exit.
- Active Live hosts cannot silently leave the Live room: Back shows **End Live & Leave** / **Stay Live**.
- If ChefVoice leaves the foreground while hosting, local Live state becomes ENDED immediately so the host WebRTC composable is disposed and camera/microphone shut down before the cloud end update.
- Cloud-backed recipes delete cloud-first. Local recipe state is removed only after Firestore deletion succeeds.
- Unpublish removes Community visibility only after the cloud update succeeds and keeps the recipe privately in Recipes.
- Deterministic parser, Second Pass, Android WebRTC transport, App Check, Storage rules, notification Functions, and Firestore rules are unchanged.
