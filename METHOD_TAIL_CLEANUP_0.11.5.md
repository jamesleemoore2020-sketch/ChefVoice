# ChefVoice 0.11.5 / Android 0.6.7 — Method Tail Cleanup

Real-device issue:
Ingredients were cleaned correctly, but Methods/Steps could still end with conversational ASR fragments such as:

- `gonna`
- `you gonna`
- `we gonna`
- `going to`
- `you are going to`

Fix:
The same end-of-phrase conversational-tail cleanup now applies to method/step text on both PWA and Android.

Example:

Before:
`Add 2 tbsp of salt and pepper you gonna.`

After:
`Add 2 tbsp of salt and pepper.`

No recipe content is silently altered beyond removing a trailing incomplete conversational fragment.

PWA deploy:
`firebase deploy --only hosting --project chefvoice-d7fec`

Android:
Run `BUILD_AND_INSTALL.cmd` from the corrected complete Android package.
