# ChefVoice 0.11.4 — Real-Voice Parser Cleanup

Real iPhone phrase added to the shared Android/PWA golden corpus:

`All right, so you're going to add 1 cup of chicken broth. You're going to add 2 tbsp of salt and pepper. You're going to add 1 cupful of chicken stock.`

Expected:
- 1 cup Chicken broth
- 2 tbsp Salt
- 2 tbsp Pepper
- 1 cup Chicken stock

Fixes:
- `cupful` and `cup full` normalize to `cup`.
- trailing `gonna`, `you gonna`, `going to` fragments are removed from ingredient names.
- action-only partials like `Add` are rejected.
- repeated opening fillers such as `All right, so` are cleaned.
- second-pass review recognizes legacy malformed names and offers `Clean up ingredient name`.
- no silent rewrite: user still chooses `Use second pass` or `Keep current`.
- `Hear source` is hidden unless a real provider timestamp exists.
- confidence text is labeled `review confidence`, not incorrectly presented as provider/model confidence.

For the current PWA/iPhone test, only Hosting needs deployment:
`firebase deploy --only hosting --project chefvoice-d7fec`

Android parser source is updated in the full/native source packages for the next Android build.
