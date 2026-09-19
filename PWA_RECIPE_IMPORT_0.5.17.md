# PWA parity, stage 4 — recipe import, and the publish policy (PWA 0.5.17, Android 0.11.17)

The last thing Android could do that the PWA could not: read a recipe from a web address.

## Why this one needed a server

Every other stage was a port. This one could not be, because a browser **refuses to fetch
another site's page from a script** — that is what the same-origin policy is for, and no
amount of client code gets around it. On Android the phone reads the page itself; in a
browser something has to read it on the chef's behalf.

That something is a new, separately-deployed Cloud Functions codebase, `chefvoice-import`,
with exactly one callable. It sits beside `chefvoice-notifications` and `chefvoice-billing`
for the same reason those are apart: a bad deploy here can never take the speech function or
the notification triggers down with it.

## What it deliberately is not

**It is not a page proxy.** It never returns the page it fetched. It returns a recipe draft,
or the reason there wasn't one. Nothing a caller can ask for makes it hand back arbitrary
content from a site, which is what stops an authenticated fetch endpoint from becoming a
general-purpose reading tool — for the internal network, or for anyone's paywalled article.

Three more things keep it narrow:

- **Sign-in is required.** An unauthenticated fetch endpoint is a public proxy, and a chef has
  to be signed in to save the result anyway.
- **Thirty imports per chef per day**, counted *before* the fetch so a chef cannot spend the
  network on pages that fail. The counter lives at `importUsage/{uid}`, a path `firestore.rules`
  never matches and therefore denies to every client in both directions — only the Admin SDK
  can see or change it, so **no rules deploy was needed**.
- **The URL rules run on every redirect hop**, not just the pasted address.

## SSRF, and the part that is genuinely new

On a phone, "don't fetch a private address" protects the chef's own network. On Google's
infrastructure it protects the project: `169.254.169.254` is the metadata server. So the
Android rules were ported exactly — https only, no credentials, no unusual ports, no
loopback, link-local, private, carrier-grade-NAT or multicast address, no `.local`/`.internal`
host, every redirect re-checked — and **one check was added that a phone does not need**:

> Every hop's hostname is **resolved first**, and the fetch is refused when any address it
> resolves to is not a public one.

A hostname-only rule cannot catch this. `evil.example` is a perfectly ordinary name that can
point straight at the metadata server. The check covers IPv4, IPv6 (loopback, unique-local,
link-local) and IPv4-mapped IPv6, and one private address among several is enough to refuse
the host.

What it does **not** close: a name that passes the check and changes its answer before the
socket opens — DNS rebinding. Closing that needs pinning the connection to the address that
was checked, which `fetch` gives no way to do. It is written down in `page-fetcher.js` rather
than left implied.

## The publish policy: warn, but allow

Session 7 left this open: nothing stopped an imported recipe being published to Community.
The decision is **warn, but allow**, on both platforms.

Publishing a recipe that was imported now asks first, naming the site it came from, and says
plainly that publishing puts another site's method on the chef's profile under their name and
that the "Source:" credit belongs in the description. Declining leaves it private. Accepting
publishes it exactly as before.

This needed one new field, `Recipe.importedFrom`, **local to the device on both platforms**.
It is never written to Firestore — Android's cloud repository and the PWA's `toCloudMap` both
allow-list the fields they send — so it needs **no rules change**. The credit that travels
with a published recipe is still the description, unchanged from 0.11.16.

## Files

New codebase `import/functions/`, all ports with their Android source named at the top:
`recipe-url.js`, `html-text.js`, `recipe-html-extractor.js`, `written-ingredient-parser.js`,
`tag-utils.js`, `recipe-importer.js`, a Node `page-fetcher.js`, and `index.js` (the callable).
Plus `RUN_IMPORT_GATES.cmd`, `DEPLOY_IMPORT.cmd`, and the codebase entry in `firebase.json`.

PWA: an import screen in `web/js/app.js` reachable from the Recipes tab, the
`importRecipeFromUrl` wrapper in `web/js/firebase-client.js`, and the publish warning.

Android: `Recipe.importedFrom`, written and read by `RecipeRepository`, set by
`RecipeImporter`, and the confirmation dialog in the recipe detail. **78 / 0.11.17.**

## Tests

Import codebase: **98 tests / 0 failures**, run by `RUN_IMPORT_GATES.cmd`. Unlike the
notification and billing gates, these are not source-text checks — the whole importer is pure
functions with injectable fetch and DNS, so every URL rule, every redirect rule and every
parsed ingredient line is actually executed. Ported row for row from Android's
`RecipeUrlTest`, `HtmlTextTest`, `RecipeHtmlExtractorTest`, `WrittenIngredientParserTest` and
`RecipeImporterTest`, plus new rows for the DNS guard, the redirect-into-a-private-address
refusal, the byte cap and the IPv6 classifier.

**Two real port bugs were caught by those tests**, both of which would have shipped silently:

1. The size-adjective check lost its anchor in translation, so any line containing a hyphen
   anywhere — "1 1/2 cups all-**purpose** flour" — had its amount thrown away.
2. The IPv6 classifier compared a single byte against 16-bit range constants, so `fe80::1`
   read as a public address.

Android: `RecipeRepositoryJsonTest` gains three rows (the field survives a restart, a narrated
recipe is not marked imported, recipes saved before imports still load) and
`RecipeImporterTest` one (the field records the page it *actually* came from after redirects).

PWA: 243 tests unchanged, plus the three jsdom checks.

## Deployed and verified live

`firebase deploy --only functions:chefvoice-import` created
`chefvoice-import:importChefVoiceRecipe(us-central1)` and touched nothing else — not
`chefvoice-notifications`, not `chefvoice-billing`, not `transcribeChefVoice`, not Hosting,
rules or App Check.

Verified by importing real pages through the deployed function from the PWA:

- **A page that publishes its recipe** (bbcgoodfood.com) imported end to end: title,
  description carrying "Source: …", serves 8, tags, four ingredient lines — including
  "Oil or melted butter, for frying", kept whole because it has no readable amount — and four
  method steps. It arrived as an ordinary recipe: cook-along, collections, scaling and the
  shopping list all work on it.
- **A page that refuses** (seriouseats.com, which answered 402) was reported to the chef as
  "That site returned an unexpected response (402)" rather than half-guessed. That is the
  designed outcome, not a failure: nothing here works around a site's own access rules.
- **The publish warning fired** on the imported recipe, named `bbcgoodfood.com`, and declining
  left the recipe private and unpublished.

The test recipe was deleted afterwards and nothing was published.

## Also deployed

PWA **0.5.17** (`hosting:pwa` only); `sw.js` on the deployed site reports `chefvoice-pwa-v0.5.17`
and the import button is on the live Recipes tab.

## Still open

**Android 0.11.17 is not built into a release or uploaded.** The publish warning only reaches
phones with a new Play build; the PWA half is live as soon as `DEPLOY_PWA.cmd` runs.
