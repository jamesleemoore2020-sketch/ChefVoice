# A chef's recording can be stopped (Android 0.11.20)

Found on James's phone on 2026-09-29, while checking the 0.11.20 release build. Private backup had
just restored a recipe with its original recording, and "▶ Play Full cooking session" played it.
Then nothing could stop it: the app had to be force-stopped.

## The problem

Every place Android plays a chef's recording had a Play button and nothing else: the recipe
screen's "Original chef voice", the cook-along's "Play chef's voice", and the voice clips on
Create's media step. Leaving the recipe left the recording playing, and so did opening the
cook-along. A full cooking session can run as long as the cooking did.

`AudioPlayer.stop()` existed, and so did `ChefAppState.stopVoice()`, but no screen had ever called
it: the code has been this way since the v0.10.1 baseline. It is not new in 0.11.20, but restore
makes it likelier, because it brings recordings back to a phone.

The web app never had this problem. It plays through the browser's own audio controls, which have
Pause, and a player that leaves the page stops.

## What changed

- `AudioPlayer` says what it is playing: the recording's location as soon as Play is pressed, so a
  cloud recording can be stopped while it loads, and nothing once it stops, finishes or fails. A
  recording that cannot be opened used to throw straight out of the tap; now it does not play, and
  the button stays Play.
- The recipe screen's recording buttons, and the cook-along's, read "■ Stop …" while their
  recording plays. TalkBack hears "Play Full cooking session" or "Stop Full cooking session", not
  the names of the symbols.
- Leaving the recipe screen, by Back or by Cook this recipe, stops its recording. So does leaving
  the cook-along.
- On Create's media step, Play becomes Stop for the clip that is playing, and removing a clip that
  is playing stops it first. Leaving Create already stopped it.

## Not changed

The parser and the golden corpus, the Firestore and Storage rules, every Functions codebase, Live,
App Check and the PWA.

## Tests

`VoicePlaybackTest` (Robolectric, demo mode, Robolectric's own MediaPlayer with a registered
ten-minute recording) covers:

- Play turning into Stop, and Stop stopping it;
- Back stopping it, and opening the cook-along stopping it;
- the cook-along's button, and its Back;
- a recording that plays to the end turning back into Play;
- a recording that cannot be opened neither crashing nor claiming to play.

Each part of the fix was undone on its own, six ways, and every time at least one test failed:

| Undone | Tests that failed |
|---|---|
| The recipe screen doesn't stop when left | 2 (leaving, opening the cook-along) |
| The cook-along doesn't stop when left | 1 |
| The recipe button never stops | 1 |
| The cook-along button never stops | 1 |
| The player never reports that it stopped | 5 |
| A recording that can't be opened throws again | 1 |

The Android suite then passed 273 / 0 (2 skipped, the opt-in renderer), golden corpus included.

## To release

This is part of 0.11.20 / 81, which had not been uploaded to Play yet, so the version stays the
same. Rebuild with `BUILD_PRODUCTION_TRUST_APK.cmd`, and upload only the rebuilt AAB. The first
0.11.20 AAB (SHA-256 `e178f486…58d2`) does not have this fix and must not be uploaded.

On the phone: play "Full cooking session" on a recipe that has one, and check that the button
reads Stop and stops it. Play it again, tap Back, and check that it has stopped.
