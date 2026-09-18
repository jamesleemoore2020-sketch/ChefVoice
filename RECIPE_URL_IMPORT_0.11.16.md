# Recipe import from a web address — 0.11.16

Android `versionCode 77` / `versionName 0.11.16`. Android only this release.

Two changes: **importing a recipe from a web address**, and a **bug fix** found on the way
in — local recipe tags were never saved to the phone. Neither touches the parser, the
corpus, the cloud, or any security rule.

## 1. Import from a web address

Recipes tab → **Import from a web address** → paste a link → **Import recipe**. The page is
read on the phone, saved as an ordinary **private** recipe, and opened straight away with a
notice asking the chef to check it against the page before cooking from it.

### Deterministic, and kept away from the parser core

Everything is in the new `importer/` package. **Nothing under `voice/`, `shared/` or the
golden corpus was touched**, and there is no language model anywhere in it — the same rule
the voice pipeline follows.

It reads the schema.org `Recipe` data (JSON-LD) that recipe sites publish for search
engines, and reports what the page says. Where the page says nothing, it says nothing:

- **No scraping of visible text.** A page with no structured recipe is reported as "doesn't
  publish its recipe in a form ChefVoice can read", and nothing is saved. An honest "not
  found" beats a half-guessed recipe. A test pins this: a page whose visible text *looks*
  like a recipe is still refused.
- **No guessing a missing yield.** If the page does not say how many it serves, servings is
  left at the app default of 2 **and the notice says so**. Likewise for missing prep/cook
  times and a missing method. Gaps are named in the notice, never filled in quietly.
- **No inferring a cook time.** A page that states only a total puts it in the cook slot
  rather than dropping it; a page that states prep and total does *not* get
  `total − prep` as cook time, because the difference might be chilling rather than cooking.
- **No splitting paragraphs into steps.** Steps split at real line breaks and list items
  only. Leading step numbers ("1.", "Step 2:") are stripped because the app numbers steps
  itself, but a step that begins with a quantity ("10-15 minutes: …", "2 cups of stock …")
  is left alone.
- **Section headings are kept.** "For the sauce" from a `HowToSection` is kept on that
  group's first step, since it says which component the step belongs to.

It copes with what real pages actually publish: a bare `Recipe`, a `@graph` bundle, an
array-typed `@type`, a recipe nested under a `WebPage`, several blocks on one page (it
prefers the whole recipe over the ingredient-less stubs a roundup page carries), HTML
entities and stray tags inside strings, ISO-8601 durations and plain "45 minutes", and the
broken JSON that turns up in the wild (raw newlines inside strings, text around the object).

### Ingredient lines

`WrittenIngredientParser` splits "1 1/2 cups all-purpose flour, sifted" into amount / unit /
name. It is **deliberately not `voice.IngredientParser`**: that parser is tuned for speech
recognition and pinned row by row by the golden corpus, while a written line fails
differently. Keeping them apart means this one can be wrong about a written line without any
possibility of disturbing a spoken one.

It **fails soft**, like the scaling code: an amount is only read when it is unambiguous.

- "1 1/2-inch piece ginger" — the number is a size, not an amount, so the whole line is kept
  as the name with no amount.
- Ranges ("1-2 tbsp", "1 to 2 tablespoons") are kept exactly as written; scaling leaves them
  alone rather than inventing a number.
- Package sizes move after the name — "1 (14.5 oz) can tomatoes" → 1 / can / "Tomatoes
  (14.5 oz)" — so two different can sizes never merge into one shopping line.
- "2 cups" with nothing after it keeps its words rather than losing them.

Units are written the way the voice parser writes them (`cup`, `tbsp`, `clove`, `L`, …), so
**scaling, metric/imperial conversion and shopping-list merging treat an imported recipe
exactly like a narrated one.** Tests pin this end to end, including merging an imported
"2 cups flour" with a narrated "1 cup flour" into 3.

### Attribution, privacy and one open decision

Imported recipes are **private and owned by no cloud account** until the chef chooses to
publish. The source is credited in the recipe **description** ("Source: <author> · <url>"),
which is the first thing shown on the recipe screen. Using the description rather than a
new field means no Firestore rules change and no deploy — the recipe-document allow-list in
`firestore.rules` would have rejected an unknown field — and it means the credit travels
with the recipe if it is published.

> **Open decision for James.** Nothing stops a chef publishing an imported recipe to
> Community. The credit line goes with it, but a chef can delete it, and the recipe text is
> someone else's. Options: leave as is; warn on publish when the description still carries
> a "Source:" line; or block publishing until the chef has edited the recipe. This needs a
> product call, so it was not decided here.

### Safe fetching

The fetch is a plain GET — no cookies, no login, no JavaScript — so it only ever sees what a
search engine sees. A site that refuses (403) is reported as refusing; there is no attempt to
get around it.

- Only web addresses. `http://` is upgraded to `https://` (Android blocks cleartext, and
  nearly every recipe site redirects anyway). `file:`, `ftp:`, `javascript:`, `content:`
  are refused, as are credentials in the link and unusual ports.
- **Public web only.** `localhost`, `*.local`/`*.lan`/`*.internal`, hosts with no dot, IPv6
  literals and private/link-local IPv4 ranges (including the `169.254.169.254` cloud
  metadata address) are refused.
- **The same rules apply to every redirect hop**, not just the first address, so a link
  cannot be bounced somewhere the chef could not have typed directly.
- 10 s connect / 15 s read timeouts, a 5 MB read cap (a bigger page is truncated, not
  refused), and only `text/*` / HTML / XML content types are read.
- Tracking parameters (`utm_*`, `fbclid`, `gclid`, …) are stripped from the address that is
  fetched and credited; parameters that choose the page (`?id=42`) are kept.
- Failures are written for the chef: not found, blocked, timed out, no connection, secure
  connection failed, too many redirects, not a web page.
- Backing out while a page is still loading **discards** the result rather than saving a
  recipe the chef walked away from.

No new dependency ships in the app: the fetch uses the platform `HttpURLConnection`, and the
JSON reading uses the `org.json` that is part of Android. `org.json` is added as a
**test-only** dependency (see below).

### Validated against real pages

Beyond the unit tests, the extractor and ingredient parser were run over five live public
recipe pages from five different sites. **All five extracted correctly** — title, author,
servings, prep/cook time, every ingredient, every step — in 5–77 ms per page (0.3–1.1 MB of
HTML). The saved body of a sixth page — a bad URL guess of mine that returned 404 — was
refused with "doesn't publish its recipe" rather than producing a recipe.

Reading the parsed ingredient lines one by one found **six real gaps the synthetic tests had
missed**, all now fixed and pinned by tests:

- `1 large can (28 ounces) diced tomatoes` and `4 medium cloves garlic` lost their unit
  because a size word came first. A size word is now lifted into a note **only when a unit
  follows** — "3 large eggs" and "1 large onion" are untouched.
- `Pinch of red pepper flakes` got no amount; a leading pinch/dash/handful/sprig/bunch now
  reads as one.
- `4 ribs celery` did not recognise "ribs" as a unit.
- Expanding "½" inside parentheses left "( 1/2 to 1 lemon)", and a source's "chips , to
  serve" kept its stray space.
- A keyword tag that was just the author's name ("cassiebest") was being offered as a tag.

Those pages are **not** committed as fixtures: they are other people's recipe text.

## 2. Bug fix: local tags were never saved

`Recipe.tags` existed and the editor let chefs set it, but `RecipeRepository` never wrote or
read it — `git log -S'"tags"'` finds no trace in that file across its whole history. So every
tag on every recipe, private or published, **was gone the next time the app closed**, while
the screen said "Tags saved to this recipe." It also meant a restart followed by **Update
Community** pushed an empty tag list over the published one.

The local JSON now writes and reads `tags`. Recipes saved by earlier versions have no such
key and load with none, as before — **tags lost before this fix are not recoverable**, but a
published recipe's tags still exist in Firestore. It was found here because imported recipes
carry tags and would have lost them on the first restart.

`toJson`/`toRecipe` became `internal` so a JVM test can round-trip a recipe through the exact
JSON the phone stores. That test was confirmed to **fail without the fix** and pass with it.

## What did not change

- **The parser.** `CookingSessionParser.kt`, `IngredientParser.kt`, the JS ports and
  `shared/golden-cooking-corpus.tsv` — no edits (`git diff` against the session-6 commit is
  empty for `voice/` and `shared/`). `GoldenCookingCorpusTest` still passes all 24.
- **`firestore.rules`, `storage.rules`, `firestore.indexes.json`** — no edits, nothing
  deployed. Attribution lives in the description precisely to avoid a rules change.
- **Cloud Functions** — neither codebase changed, and nothing new is called. The import runs
  entirely on the phone.
- **Live/WebRTC**, **App Check** (still monitoring-only), **ChefVoice Review** and its
  5-minute cap.
- **The PWA.** No `web/` file changed; it stays at 0.5.12 and has no import.

## Gates

Android `:app:testDebugUnitTest` — **205 tests, 0 failures** (108 before this release):

| Suite | Tests |
| --- | --- |
| `RecipeHtmlExtractorTest` | 28 (new) |
| `WrittenIngredientParserTest` | 20 (new) |
| `RecipeUrlTest` | 15 (new) |
| `RecipeImporterTest` | 13 (new) |
| `PageFetcherTest` | 10 (new) |
| `HtmlTextTest` | 7 (new) |
| `RecipeRepositoryJsonTest` | 4 (new) |
| `GoldenCookingCorpusTest` | 24 (unchanged) |
| `SecondPassReviewerTest` | 19 (unchanged) |
| others | 65 (unchanged) |

PWA `npm test` — 130 tests, 0 failures, unchanged.

Two subtle behaviours were **mutation-checked** — the fix was removed and the test confirmed
to fail: the raw-newline JSON repair, and the "a size is not an amount" guard. (The first
also showed the JVM `org.json` really does reject raw newlines, so the repair is doing real
work.)

`org.json:json:20240303` is a `testImplementation` dependency only, because `android.jar`
ships `org.json` as throwing stubs and a JVM test that touches `JSONObject` otherwise dies
with "not mocked". It is never packaged into the app.

## Not yet verified on a device

**The import screen has not been run.** No device was attached and no emulator is installed
in this environment. What *is* verified: everything above, plus `:app:assembleDebug` and
`:app:assembleRelease` (R8, signed with the release key, 77 / 0.11.16) building clean. What
is **not**: the screen's layout and keyboard behaviour, the Paste button, back handling while
a page loads, and — the one that matters most — the real fetch through Android's own network
stack (TLS, redirects, gzip).

The whole import path, with the real `HttpPageFetcher`, was run against live servers from a
desktop JVM, which uses a different `HttpURLConnection` from the phone's:

| Input | Result |
| --- | --- |
| A BBC Good Food link typed as `http://` | Upgraded to https, imported (6 ingredients, 5 steps), credited to the final https address |
| A Cookie and Kate link pasted inside a sentence, with `utm_` parameters | Link extracted, tracking stripped, imported (16 ingredients, 7 steps) |
| `https://example.com/` | Refused: "doesn't publish its recipe" |
| A 404 page | "That page wasn't found" |
| An unresolvable host | "couldn't reach that site" |
| `https://192.168.1.1/` | Refused in 1 ms, **no request made** |
| **A Simply Recipes link** | **Blocked** — see below |

**One of the three real recipe sites blocked the fetch.** Simply Recipes answered the JVM's
`HttpURLConnection` with HTTP 403 and `Cf-Mitigated: challenge` — a Cloudflare bot
challenge — although curl, and Java's newer HTTP client sending the *same headers*, both
received the full page. So it is the connection, not the request, that gets challenged. The
app reports it honestly ("That site wouldn't let ChefVoice read the page. Some sites block
apps; try another link.") and saves nothing. **Whether the phone's network stack is
challenged the same way is unknown until it is tried on the device.** This is the first thing
to check, on a handful of well-known recipe sites, before this ships.

## Known limits

- **JSON-LD only.** Older sites that publish recipes only as HTML microdata are reported as
  not found. A microdata fallback is possible if real pages need it.
- **Sites that block apps, or render the recipe with JavaScript, will fail** — with a message
  saying so, and nothing is saved. Cloudflare-style bot challenges are the live example
  (see above). ChefVoice does not try to defeat them, and should not: it is a plain
  request by design. If device testing shows that too many sites refuse it, the honest
  escalation is to read the page through the phone's own **WebView** (a real browser engine,
  which also handles pages that build the recipe with JavaScript), not to imitate a browser.
- **No share-sheet target yet.** Importing means copying the link and pasting it; the
  natural flow — Share → ChefVoice from the browser — needs an intent filter and is the
  obvious next step.
- **Photos are not imported**, only text.
- **Tags come from category, cuisine and keywords** (up to 5, author name excluded) and can
  still be site noise ("publishertested"); the chef edits them like any tag.
- Imported recipe text is the source site's. See the open decision above.
