# ChefVoice Shared Golden Cooking Corpus

`golden-cooking-corpus.tsv` is the cross-platform source of truth for cooking-language behavior.

Both the PWA and the native Android parser must produce the same structured ingredients and required method-step fragments for every row.

## Columns

1. fixture id
2. category
3. transcript segments separated by ` || `
4. expected ingredients separated by ` ;; `, each encoded as `quantity^unit^name`
5. required step substrings separated by ` ;; `, or `-`

## Rule for future development

Whenever a real iPhone or Android cooking phrase fails:

1. Add the exact phrase as a new corpus row first.
2. Confirm which platform fails.
3. Fix the parser without weakening existing rows.
4. Make both Android and PWA pass the same fixture before release.

This corpus is intentionally deterministic. AI/transcription systems may improve the transcript before it reaches the parser, but they do not redefine the expected structured result silently.
