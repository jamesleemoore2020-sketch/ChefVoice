# ChefVoice Android 0.7.7 / PWA 0.12.2 — Method Apply Closure

Real-device bug addressed:
- Method review correctly generated one "Check corrected method" card for:
  `Add chicken to the pan and cook for 10 minutes. Actually, cook for 20 minutes and flip halfway.`
- After tapping "Use second pass", the reviewer rebuild could resurrect the superseded `Cook for 10 minutes` step.
- On device this produced three recipe steps instead of the expected two.

Narrow fix:
- Preserve the second-pass transcript as correction evidence during every Method Review build/rebuild.
- When a deterministic correction cue identifies a corrected later second-pass method step, suppress only the related pre-correction second-pass step from review matching.
- This keeps the stale step suppressed after acceptance and on subsequent Second Pass reruns.
- No LLM parsing or cleanup was added.
- Raw cooking audio and both transcripts remain untouched.
- Recipe methods still change only after explicit user acceptance.

Expected accepted recipe methods:
1. Add chicken to the pan.
2. Cook for 20 minutes and flip halfway.

Automated gates:
- PWA: 118/118 PASS
- Android shared golden cooking corpus: 45/45 PASS
- Android Method Review core gates: 8/8 PASS
- Android/PWA golden corpus: byte-identical

Real-device status:
- Generated candidate only. Android 0.7.7 is NOT real-device accepted until tested by the user.
