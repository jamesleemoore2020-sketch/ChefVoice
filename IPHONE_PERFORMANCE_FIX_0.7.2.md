# ChefVoice PWA 0.7.2 — iPhone Performance + Camera Fix

## Real-device issues targeted

1. iPhone Live could switch front → rear but fail rear → front.
2. Cook & Capture became visibly laggy on iPhone after Alpha 7 reliability work.

## Camera change

- iPhone now prefers the exact remembered/enumerated `deviceId` when switching.
- `facingMode` is fallback only.
- The just-stopped camera device is rejected if Safari silently reopens it.
- Release delay increased to 400 ms before requesting the other camera.
- Existing peer video tracks are replaced without restarting the Live room.

## Capture performance change

- MediaRecorder recovery chunks changed from 1 second to 5 seconds.
- IndexedDB checkpoint pressure is reduced.
- Interim speech parsing/UI updates are throttled to ~220 ms.
- Interim speech only refreshes the capture instrument; full editable lists update on finalized speech.
- The REC clock updates in place instead of rebuilding the capture card every second.

## Protected behavior

The deterministic ingredient parser is not replaced or weakened.
Raw recording remains independent from live speech recognition.

## Test focus

- Front → back → front repeatedly on the real iPhone.
- Start Cook & Capture and speak ingredients naturally.
- Confirm “Hearing now” and live detected ingredients remain responsive.
- Confirm finalized ingredients appear in the editable Ingredients list.
