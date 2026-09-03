# ChefVoice Android v0.9.13 — Saved Recipe Step Media

## Goal

Let a recipe owner add or remove photos and videos after saving a recipe, including media tied to an individual Method step, without cluttering the normal recipe-reading experience or weakening ChefVoice's local-first/cloud-safety model.

## UX

- Owner opens a saved recipe and taps **Edit media**.
- Edit mode exposes **+ Photo** and **+ Video** for the whole recipe and beneath every Method step.
- **Done** exits edit mode; add/remove controls disappear.
- Whole-recipe media remains in the compact Photos & video section.
- Step media renders directly under its Method step.
- During **Cook this recipe**, media attached to the current step can appear as a visual reference.
- Removing media edits the local recipe immediately.

## Stable Method identity

`Recipe.stepIds` is parallel to `Recipe.steps`. New recipes receive UUID step IDs. Existing recipes migrate deterministically using `<recipeId>:step:<1-based index>` when no stored ID exists.

`MediaAttachment` now supports:

- `stepId` — blank means whole-recipe media; otherwise it targets one Method row.
- `caption` — reserved for later caption UI.

Second Pass insertion preserves existing step IDs and inserts a new ID only for the newly inserted Method step, preventing later media from shifting to the wrong instruction.

## Local-first Community behavior

A media change to a public recipe sets `communityUpdatePending=true`. The edit remains local and the UI shows **Update Community**. Only the owner's explicit action reuses the existing authenticated recipe publish/upload path.

No recipe is silently republished because a photo/video was added or removed.

## Cloud schema

Public recipe serialization adds:

- `stepIds: string[]`
- `media[].stepId`
- `media[].caption`

Existing recipe ownership write rules are unchanged. Existing public recipe media Storage limits remain 25 MB for images and 200 MB for videos.

## Protected systems unchanged

- deterministic cooking parser
- ingredient parser
- Second Pass reviewer logic
- original raw cooking audio privacy/truth-source behavior
- Firestore rules
- Storage rules
- notification Functions / IAM
- App Check enforcement state
- Speech backend
- Live WebRTC transport
