package com.chefvoice.app.voice

import com.chefvoice.app.model.Ingredient
import com.chefvoice.app.model.TranscriptSegment

data class CookingDraft(
    val ingredients: List<Ingredient>,
    val steps: List<String>,
    val title: String = "",
    val prepMinutes: Int? = null,
    val cookMinutes: Int? = null
)

/**
 * Local-first recipe structuring for a narrated cooking session.
 *
 * v0.2.2 deliberately does not trust SpeechRecognizer segment boundaries.
 * Android may split an utterance in the middle of an ingredient, for example:
 *   "add two teaspoons" | "of salt"
 * so ChefVoice parses individual segments, adjacent segment windows, and the
 * complete joined transcript before de-duplicating the result.
 */
object CookingSessionParser {
    private val quantityPattern = Regex(
        "(?i)\\b(?:" +
            "(?:\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\\s+and\\s+(?:a\\s+|one\\s+)?(?:half|quarter)" +
            "|\\d+\\s+\\d+/\\d+" +
            "|(?:one|two|three)\\s+(?:halves|thirds|quarters|fourths)" +
            "|(?:half|quarter)\\s+(?:of\\s+)?a" +
            "|a\\s+(?:half|quarter)" +
            "|\\d+/\\d+|\\d+(?:\\.\\d+)?" +
            "|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|half|quarter|couple|dozen|a|an" +
        ")\\b"
    )

    private val actionWords = setOf(
        "add", "adding", "bake", "baking", "beat", "blend", "boil", "bring", "brown",
        "chop", "combine", "cook", "cooking", "cut", "dice", "divide", "drain", "drop", "flip", "fold", "form", "fry", "throw",
        "heat", "knead", "make", "marinate", "melt", "mix", "pat", "peel", "place", "pour", "preheat", "reduce",
        "rest", "roast", "saute", "sauté", "season", "sear", "serve", "settle", "shape", "shaped", "simmer", "slice", "split",
        "sprinkle", "stir", "toast", "toss", "transfer", "turn", "whisk"
    )

    private val ingredientLead = Regex("(?i)^(?:ingredient|ingredients)\\s*[:,-]?\\s*")
    private val stepLead = Regex("(?i)^(?:step(?:\\s+\\d+)?|method|instruction)\\s*[:,-]?\\s*")

    private val ingredientContext = Regex(
        "(?i)\\b(?:ingredient|add|adding|use|using|pour|pouring|stir\\s+in|stirring\\s+in|mix\\s+in|mixing\\s+in|put\\s+in|putting\\s+in|throw\\s+in|throwing\\s+in|drop\\s+in|dropping\\s+in|fold\\s+in|folding\\s+in|need|take|season\\s+with|seasoning\\s+with|sprinkle|top\\s+with|combine)\\b"
    )

    // Unmeasured ingredients need stronger evidence than conversational words like
    // "need" or "take"; otherwise narration such as "what you need to do" becomes
    // a fake ingredient row.
    //
    // 0909: "need" is admitted in exactly one shape -- when a determiner follows it,
    // as in "you're going to need some sour cream". That is a real declaration and it
    // cost three ingredients (sour cream, hot sauce, jalapenos) on a real device
    // transcript. "what you need to do" is still excluded, because "to" is not one of
    // the determiners; the lookahead, not the verb, is what carries the evidence.
    //
    // 0909b: "your" joins the determiner set for the same reason -- "you're going to
    // need your favorite Dorito chips" is a declaration, not narration. "to" still
    // fails the lookahead, so "what you need to do" stays excluded.
    private val unmeasuredIngredientContext = Regex(
        "(?i)^\\s*(?:(?:then|next|and|now|so|okay|ok|alright|all\\s+right)[, ]+)*(?:(?:i|you|we)(?:'m|'re|'ll| am| are| will)?\\s+)?(?:(?:am|are)\\s+)?(?:going\\s+to\\s+|gonna\\s+|want\\s+to\\s+|will\\s+)?(?:add|adding|use|using|pour(?:ing)?(?:\\s+in)?|stir(?:ring)?\\s+in|mix(?:ing)?\\s+in|put(?:ting)?\\s+in|throw(?:ing)?\\s+in|drop(?:ping)?\\s+in|fold(?:ing)?\\s+in|need(?=\\s+(?:some|an?|your)\\b)|season(?:ing)?\\s+with|sprinkle|top(?:ping)?\\s+with|combine)\\b"
    )

    // 0909: a yield sentence describes how many people the dish feeds, not what goes
    // into it. "One pack should feed at least two people, maybe three" was mined for
    // two phantom ingredients ("Pack should feed at least", "People, maybe"). Bare
    // "serve" is deliberately absent -- it is a method verb ("ready to serve and eat")
    // and excluding it here would suppress real closing steps.
    private val servingYieldContext = Regex(
        "(?i)\\b(?:feed|feeds|serves|serving|servings)\\b"
    )

    // 0909: an unmeasured name that opens with a back-reference is pointing at
    // something already introduced, not naming a new ingredient. "You sprinkle it on
    // top of your nachos" produced the ingredient "It on top of your nachos".
    private val backReferenceName = Regex(
        "(?i)^(?:it|its|them|they|this|that|those|these)\\b"
    )

    // 0909: a segment that opens a fresh "need some X" declaration is a standalone
    // ingredient line, never the tail of the previous method step. The
    // ingredient-continuation branch in collectSegmentAwareSteps exists so that
    // "season the patties" followed by "with salt and pepper" join into one step; once
    // "need some X" started yielding ingredients, that branch began swallowing these
    // declarations into whatever step came before them. Matching the same shape the
    // declaration is admitted by keeps the two rules in step.
    private val ingredientDeclarationSegment = Regex(
        "(?i)^\\s*(?:(?:then|next|and|now|so|okay|ok|alright|all\\s+right)[, ]+)*(?:(?:i|you|we)(?:'m|'re|'ll| am| are| will)?\\s+)?(?:(?:am|are)\\s+)?(?:going\\s+to\\s+|gonna\\s+|want\\s+to\\s+|will\\s+)?need\\s+(?:some|an?|your)\\b"
    )

    private val ingredientNoiseName = Regex(
        "(?i)^(?:to|of|the|it|this|that|some|what|today|tomorrow|we|you|i|and|or|then|so|um|uh)$"
    )

    private val ingredientArtifactName = Regex("(?i)^(?:grab|stuff|tasteful)$")

    // 0.5.5 PWA parity: a segment boundary sometimes falls right after a prep
    // modifier and before the noun it describes ("one pound of ground" | "beef"
    // as two ASR chunks), so the per-segment pass sees "ground" alone and it
    // reads as a syntactically fine unmeasured ingredient. None of these words
    // is ever a complete ingredient on its own.
    private val bareModifierName = Regex(
        "(?i)^(?:ground|diced|sliced|chopped|minced|grated|shredded|crushed|boneless|skinless|peeled|cubed)$"
    )

    // ASR frequently drops the leading pronoun off "you're going to let it cook"
    // -- leaving a bare "going to let the X" fragment that still needs to be
    // rejected as a dangling instruction, not just the pronoun-led form.
    private val narrationNoiseName = Regex(
        "(?i)^(?:(?:today|so|what|you|we|i)\\b.*\\b(?:gonna|going|need|make|do)\\b|(?:gonna|going\\s+to)\\b)"
    )

    private val cookingOnlyNames = Regex(
        "(?i)^(?:(?:minute|minutes|second|seconds|hour|hours|degree|degrees)\\b.*|fahrenheit|celsius|pan|pot|bowl|skillet|oven|tray|dish|mixture|heat|medium heat|high heat|low heat)$"
    )

    private val temperatureOnlyName = Regex(
        "(?i)^\\d+(?:\\.\\d+)?\\s*(?:°(?:\\s*[fc])?|degrees?(?:\\s+(?:fahrenheit|celsius))?)$"
    )

    private val methodOutputCountContext = Regex(
        "(?i)^\\s*(?:and\\s+)?(?:(?:i|you|we)(?:'m|'re| am| are)?\\s+)?(?:going\\s+to\\s+|gonna\\s+)?(?:make|form|shape|split|divide|pat)\\b"
    )

    // 0909: "need" joins this list because a window parse concatenates adjacent
    // segments without punctuation, and "...some sour cream you're going to need some
    // hot sauce" was becoming one ingredient name. Splitting before the verb keeps
    // each declaration separate without guessing at any word.
    private val narratedActionBoundary = Regex(
        "(?i)\\s+(?=(?:and\\s+)?(?:(?:i|you|we)(?:'m|'re| am| are)?\\s+)?(?:going\\s+to\\s+|gonna\\s+)?(?:add|adding|use|using|take|taking|get|getting|need|needing|pour|pouring|stir|stirring|mix|mixing|put|putting|throw|throwing|drop|dropping|fold|folding|season|seasoning|sprinkle|combine|bake|cook|simmer|roast|sear|whisk|chop|make|split|divide|shape|form|pat|preheat|serve)\\b)"
    )

    private val methodContinuationCue = Regex(
        "(?i)\\b(?:in\\s+between|halfway|on\\s+both\\s+sides|each\\s+side|during\\s+(?:cooking|baking|roasting)|before\\s+serving)\\b"
    )

    private val durationOnlyMethodContinuation = Regex(
        "(?i)^(?:for\\s+)?(?:about\\s+|approximately\\s+)?(?:\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\\s+(?:seconds?|minutes?|hours?)$"
    )

    private val durationAttachableMethod = Regex(
        "(?i)\\b(?:cook|bake|roast|simmer|boil|fry|sear|broil|rest|settle|marinate|heat)\\b"
    )

    // When one timestamp contains several ASR predicates without punctuation, split
    // repeated direct-object clauses without guessing the recognized verb. Example:
    // "shape them and pet them down see them both sides" keeps Shape/Pet/See as
    // separate ordered clauses. Unknown words remain verbatim for Second Pass review.
    private val repeatedThemBoundary = Regex(
        "(?i)(\\bthem(?:\\s+(?:down|up|over|through|well|evenly|out|off|aside|together|apart|back|around|both|again)){0,2})\\s+(?:and\\s+)?(?=[a-z][a-z'-]*\\s+them\\b)"
    )

    private val uncertainThemClause = Regex("(?i)^[a-z][a-z'-]*\\s+them\\b")

    private val ingredientMethodContinuationAction = Regex(
        "(?i)\\b(?:season|seasoning|sprinkle|top|add|adding|mix|mixing|combine|combining)\\b"
    )

    private val methodTemperatureAfterFor = Regex(
        "(?i)\\b(cook|bake|roast|heat|preheat|sear|fry|broil)\\b([^.!?]{0,80}?)\\bfor\\s+(\\d+(?:\\.\\d+)?\\s*(?:°(?:\\s*[fc])?|degrees?(?:\\s+(?:fahrenheit|celsius))?))(?=\\s|$|[,.!?])"
    )

    // ---- Recipe title from an opening announcement ---------------------------
    // Ported from cooking-session-parser.js (0.5.5). Only fires on an explicit
    // "here's what I'm making" announcement, never inferred from ambient
    // narration -- an unmatched transcript leaves the title for the chef to
    // type, same as it always has.
    //
    // Matched per sentence-like unit (each raw segment, further split only on
    // hard punctuation) rather than through splitNarration's clause splitting:
    // splitNarration's verb-boundary splitting (needed elsewhere to isolate
    // method instructions) can separate a leading pronoun from its verb --
    // "Today I'm going to make chili" becomes "Today I'm going to" | "make
    // chili" -- which would silently defeat a pattern that needs both in the
    // same piece of text. A live ASR segment is itself a natural,
    // pause-delimited sentence boundary: the capture below runs to the end of
    // whichever unit it matched in.
    //
    // The pronoun+auxiliary ("I'm"/"we're"/"I am"/"we are") is mandatory, not
    // optional: a bare imperative like "make four burger patties" is a real,
    // common mid-recipe instruction, and without a required pronoun it reads
    // as a title announcement just as easily as "we're making hamburgers"
    // does. "Making/make/cooking/cook" is further gated to the first two
    // units (chefs say the name at the very beginning) so a later "we're
    // going to cook the beef now" mid-recipe line can't be mistaken for it.
    // The "recipe for"/"this recipe is" phrasings are distinctive framing
    // sentences a chef would not say mid-step, so those are allowed in any
    // unit.
    private const val titleStopBoundary = "(?=[,.!?]|\\s+(?:and\\s+)?(?:i|you|we)(?:'m|'re| am| are)\\b|$)"
    // Chefs and ASR both drop the copula ("so today we going to make my famous top
    // ramen meal"), so the auxiliary is optional -- but only on a much narrower
    // path: "going to"/"gonna" must carry the sentence instead, and the verb must
    // be "make"/"making". Without the auxiliary, "we going to cook our ground beef
    // for 10 mins" is an ordinary instruction, not an announcement, and claiming it
    // as the title would also delete that step and its duration. The pronoun stays
    // mandatory on both paths, so a bare imperative is still rejected.
    private val titleMakingPattern = Regex(
        "(?i)(?:today[, ]*)?(?:i|we)(?:(?:'m|'re| am| are)\\s+(?:going\\s+to\\s+|gonna\\s+)?(?:making|make|cooking|cook|doing|do)|\\s+(?:going\\s+to\\s+|gonna\\s+)(?:making|make|doing|do))\\s+(.{1,60}?)$titleStopBoundary"
    )
    private val titleRecipeForPattern = Regex(
        "(?i)this\\s+is\\s+(?:my|a|the)\\s+recipe\\s+for\\s+(.{1,60}?)$titleStopBoundary"
    )
    private val titleThisRecipeIsPattern = Regex(
        "(?i)this\\s+recipe\\s+is\\s+(?:for\\s+)?(.{1,60}?)$titleStopBoundary"
    )

    private fun cleanRecipeTitle(captured: String): String {
        val cleaned = captured
            .split(",").first()
            .replace(Regex("(?i)^(?:a|an|the|some|my)\\s+"), "")
            .replace(Regex("\\s+"), " ")
            .trim()
        if (cleaned.isBlank() || cleaned.length > 60) return ""
        return capitalizeIngredient(cleaned)
    }

    private fun titleSearchUnits(normalizedSegments: List<String>): List<String> {
        val units = mutableListOf<String>()
        normalizedSegments.forEach { segment ->
            segment.split(Regex("[.!?]+")).forEach { sentence ->
                val trimmed = sentence.trim()
                if (trimmed.isNotBlank()) units.add(trimmed)
            }
        }
        return units
    }

    private fun extractRecipeTitle(normalizedSegments: List<String>): String {
        val units = titleSearchUnits(normalizedSegments)

        units.take(2).forEach { unit ->
            val match = titleMakingPattern.find(unit)
            if (match != null) {
                val title = cleanRecipeTitle(match.groupValues[1])
                if (title.isNotBlank()) return title
            }
        }

        units.forEach { unit ->
            val match = titleRecipeForPattern.find(unit) ?: titleThisRecipeIsPattern.find(unit)
            if (match != null) {
                val title = cleanRecipeTitle(match.groupValues[1])
                if (title.isNotBlank()) return title
            }
        }
        return ""
    }

    // A step that is itself the opening title announcement ("Make my famous
    // chili.") is not a cooking instruction -- without this it would show up
    // both as the recipe title and as a redundant first Method step. Checked
    // against the already-extracted title text directly (cleanStep has
    // already stripped the leading pronoun that titleMakingPattern requires,
    // so that pattern itself can no longer match here).
    private fun isTitleAnnouncementStep(step: String, title: String): Boolean {
        if (title.isBlank()) return false
        val stripped = step.trimEnd('.', '!', '?').trim()
        val escapedTitle = Regex.escape(title)
        val restatementPattern = Regex(
            "(?i)^(?:(?:making|make|cooking|cook)\\s+(?:my\\s+)?|this\\s+is\\s+(?:my|a|the)\\s+recipe\\s+for\\s+|this\\s+recipe\\s+is\\s+(?:for\\s+)?)$escapedTitle$"
        )
        return restatementPattern.matches(stripped)
    }

    // ---- Prep/cook time estimate ----------------------------------------------
    // Sums minute/hour durations already present in the finished method steps,
    // bucketed by an unambiguous prep verb (before heat -- chop/dice/slice/
    // peel/mince) or an unambiguous cook verb (heat applied -- cook/bake/
    // roast/simmer/boil/fry/sear/saute/brown/toast/preheat/melt/reduce). A
    // step naming both kinds of verb, or neither, contributes to neither
    // total: this is an estimate from durations the chef actually said, never
    // a guess, matching the rest of this parser.
    private val prepPhaseVerb = Regex(
        "(?i)\\b(?:chop|chopping|chopped|dice|dicing|diced|slice|slicing|sliced|peel|peeling|peeled|mince|mincing|minced)\\b"
    )
    private val cookPhaseVerb = Regex(
        "(?i)\\b(?:cook|cooking|cooked|bake|baking|baked|roast|roasting|roasted|simmer|simmering|simmered|boil|boiling|boiled|fry|frying|fried|sear|searing|seared|saut[ée](?:ing|ed)?|brown|browning|browned|toast|toasting|toasted|preheat|preheating|preheated|melt|melting|melted|reduce|reducing|reduced)\\b"
    )
    private val durationNumberWords = mapOf(
        "one" to 1, "two" to 2, "three" to 3, "four" to 4, "five" to 5, "six" to 6, "seven" to 7,
        "eight" to 8, "nine" to 9, "ten" to 10, "eleven" to 11, "twelve" to 12, "thirteen" to 13,
        "fourteen" to 14, "fifteen" to 15, "sixteen" to 16, "seventeen" to 17, "eighteen" to 18,
        "nineteen" to 19, "twenty" to 20
    )
    private val stepDurationPattern = Regex(
        "(?i)(\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\\s+(hours?|minutes?|mins?)\\b"
    )

    private fun durationToMinutes(numberToken: String, unitToken: String): Double? {
        val token = numberToken.lowercase()
        val amount = durationNumberWords[token]?.toDouble() ?: token.toDoubleOrNull() ?: return null
        return if (unitToken.startsWith("hour", ignoreCase = true)) amount * 60 else amount
    }

    private fun stepDurationMinutes(step: String): Double? {
        val match = stepDurationPattern.find(step) ?: return null
        return durationToMinutes(match.groupValues[1], match.groupValues[2])
    }

    private data class PrepCookEstimate(val prepMinutes: Int?, val cookMinutes: Int?)

    private fun estimatePrepCookMinutes(steps: List<String>): PrepCookEstimate {
        var prepMinutes: Double? = null
        var cookMinutes: Double? = null
        steps.forEach stepLoop@{ step ->
            val minutes = stepDurationMinutes(step) ?: return@stepLoop
            val isPrep = prepPhaseVerb.containsMatchIn(step)
            val isCook = cookPhaseVerb.containsMatchIn(step)
            if (isPrep && !isCook) prepMinutes = (prepMinutes ?: 0.0) + minutes
            else if (isCook && !isPrep) cookMinutes = (cookMinutes ?: 0.0) + minutes
        }
        return PrepCookEstimate(
            prepMinutes = prepMinutes?.let { Math.round(it).toInt() },
            cookMinutes = cookMinutes?.let { Math.round(it).toInt() }
        )
    }

    // A chef stating "prep time five minutes, cook time twenty minutes"
    // outright is stronger evidence than inferring it from a verb elsewhere,
    // and "cook time" alone has no ingredient/method content -- left in place
    // it either vanishes silently (no recognized unit, "prep" isn't a method
    // verb) or turns into a meaningless "Cook time." step (bare "cook" is a
    // method verb). Both statements are pulled out of the transcript before
    // any other parsing runs.
    private val prepTimeStatement = Regex(
        "(?i)\\bprep\\s*time\\s*(?:is\\s*|for\\s*|of\\s*)?(\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\\s*(hours?|minutes?|mins?)\\b"
    )
    private val cookTimeStatement = Regex(
        "(?i)\\bcook\\s*time\\s*(?:is\\s*|for\\s*|of\\s*)?(\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\\s*(hours?|minutes?|mins?)\\b"
    )

    private data class StatedTimes(
        val prepMinutes: Int?,
        val cookMinutes: Int?,
        val remainingSegments: List<String>
    )

    private fun extractStatedTimes(normalizedSegments: List<String>): StatedTimes {
        var prepMinutes: Double? = null
        var cookMinutes: Double? = null
        val remaining = normalizedSegments.map { segment ->
            var text = segment
            val prepMatch = prepTimeStatement.find(text)
            if (prepMatch != null) {
                prepMinutes = durationToMinutes(prepMatch.groupValues[1], prepMatch.groupValues[2])
                text = text.removeRange(prepMatch.range.first, prepMatch.range.last + 1)
            }
            val cookMatch = cookTimeStatement.find(text)
            if (cookMatch != null) {
                cookMinutes = durationToMinutes(cookMatch.groupValues[1], cookMatch.groupValues[2])
                text = text.removeRange(cookMatch.range.first, cookMatch.range.last + 1)
            }
            text.replace(Regex("\\s+"), " ").trim()
        }
        return StatedTimes(
            prepMinutes = prepMinutes?.let { Math.round(it).toInt() },
            cookMinutes = cookMinutes?.let { Math.round(it).toInt() },
            remainingSegments = remaining
        )
    }

    fun parse(segments: List<TranscriptSegment>): CookingDraft {
        if (segments.isEmpty()) return CookingDraft(emptyList(), emptyList())

        val rawNormalized = segments
            .map { IngredientParser.normalizeSpeechText(it.text).trim() }
            .filter { it.isNotBlank() }

        val statedTimes = extractStatedTimes(rawNormalized)
        val normalized = statedTimes.remainingSegments.filter { it.isNotBlank() }

        val ingredients = mutableListOf<Ingredient>()
        val steps = mutableListOf<String>()

        // 1) Parse the whole transcript so ingredient phrases survive arbitrary ASR
        //    segment breaks such as "two teaspoons" | "of salt". For a multi-segment
        //    capture, timestamp boundaries are method evidence, so the whole pass does
        //    not create Method steps; those are collected below in original order.
        parseNarration(
            normalized.joinToString(" "),
            ingredients,
            steps,
            collectSteps = normalized.size == 1
        )

        // 2) Parse two/three-segment windows. This recovers local context without
        //    letting a very long transcript swallow later action phrases.
        for (windowSize in 2..3) {
            if (normalized.size >= windowSize) {
                normalized.windowed(windowSize).forEach { window ->
                    parseNarration(window.joinToString(" "), ingredients, steps, collectSteps = false)
                }
            }
        }

        // 3) Keep the old per-segment pass too because recognizers sometimes return
        //    useful punctuation only in their final individual segments.
        normalized.forEach { parseNarration(it, ingredients, steps, collectSteps = false) }

        if (normalized.size > 1) {
            steps.addAll(collectSegmentAwareSteps(normalized))
        }

        val fullTranscript = normalized.joinToString(" ")
        val correctedIngredients = dedupeIngredients(
            applyCorrections(fullTranscript, dedupeIngredients(ingredients))
        )

        val title = extractRecipeTitle(normalized)
        val finalSteps = dedupeSteps(steps).filterNot { isTitleAnnouncementStep(it, title) }
        val inferredTimes = estimatePrepCookMinutes(finalSteps)

        return CookingDraft(
            // Canonicalization is part of the parsed recipe boundary. The UI and
            // later review passes should never receive obvious ASR tails as
            // ingredient identity.
            ingredients = RecipeCanonicalizer.canonicalizeIngredients(correctedIngredients),
            steps = finalSteps,
            title = title,
            prepMinutes = statedTimes.prepMinutes ?: inferredTimes.prepMinutes,
            cookMinutes = statedTimes.cookMinutes ?: inferredTimes.cookMinutes
        )
    }

    private fun parseNarration(
        narration: String,
        ingredients: MutableList<Ingredient>,
        steps: MutableList<String>,
        collectSteps: Boolean
    ) {
        splitNarration(narration).forEach clauseLoop@ { clause ->
            val trimmed = clause.trim().trim(',', '.', ';', ':')
            if (trimmed.isBlank()) return@clauseLoop

            val explicitIngredient = ingredientLead.containsMatchIn(trimmed)
            val explicitStep = stepLead.containsMatchIn(trimmed)
            val ingredientSource = ingredientLead.replace(trimmed, "").trim()

            val localIngredients = if (explicitIngredient) {
                extractIngredients(ingredientSource, allowUnmeasured = true)
            } else {
                extractIngredients(trimmed, allowUnmeasured = false)
            }
            localIngredients.forEach(ingredients::add)

            val cleanedStep = cleanStep(stepLead.replace(trimmed, ""))
            val words = cleanedStep.lowercase().split(Regex("[^a-zA-ZÀ-ÿ]+"))
            val hasAction = words.any { it in actionWords } ||
                (methodOutputCountContext.containsMatchIn(trimmed) && quantityPattern.containsMatchIn(trimmed))
            val ingredientOnly = explicitIngredient && !hasAction && !explicitStep

            if (collectSteps && !ingredientOnly && (explicitStep || hasAction)) {
                val structured = buildStructuredIngredientActionStep(trimmed, localIngredients)
                val stepValue = structured ?: cleanedStep
                if (stepValue.length >= 4) steps.add(sentenceCase(stepValue))
            }
        }
    }

    private fun splitNarration(text: String): List<String> {
        return text
            .replace(Regex("(?i)\\s+(?:and\\s+then|but\\s+then|then|next|after\\s+that)\\s+"), ". ")
            // ASR often omits punctuation. A second cooking verb is a useful soft
            // sentence boundary: "add salt add pepper" becomes two clauses.
            .replace(narratedActionBoundary, ". ")
            .replace(repeatedThemBoundary, "$1. ")
            .split(Regex("[.!?;]+"))
            .map { it.trim() }
            .filter { it.isNotBlank() }
    }

    private fun extractIngredients(raw: String, allowUnmeasured: Boolean): List<Ingredient> {
        val normalizedRaw = IngredientParser.normalizeSpeechText(raw)
        // A yield sentence carries quantities that look exactly like ingredient
        // quantities ("feed at least two people"), so it has to be rejected before
        // any extraction runs rather than filtered out of the results afterwards.
        if (servingYieldContext.containsMatchIn(normalizedRaw)) return emptyList()
        val hasIngredientContext = ingredientContext.containsMatchIn(normalizedRaw)
        val hasStrongUnmeasuredContext = unmeasuredIngredientContext.containsMatchIn(normalizedRaw)

        var source = normalizedRaw
            .replace(Regex("(?i)^(?:(?:okay|ok|so|now|alright|all right|then|next|and)[, ]+)+"), "")
            .replace(
                Regex(
                    "(?i)^(?:(?:i|you|we)(?:'m|'re|'ll| am| are| will)?\\s+)?(?:(?:am|are)\\s+)?(?:going\\s+to\\s+|gonna\\s+|want\\s+to\\s+|will\\s+)?(?:add(?:ing)?(?:\\s+in)?|use|using|pour(?:ing)?(?:\\s+in)?|stir(?:ring)?\\s+in|mix(?:ing)?\\s+in|put(?:ting)?\\s+in|throw(?:ing)?\\s+in|drop(?:ping)?\\s+in|fold(?:ing)?\\s+in|need|take|season(?:ing)?\\s+with|sprinkle|top(?:ping)?\\s+with|combine)\\s+"
                ),
                ""
            )
            .trim()

        source = trimIngredientTail(source)

        val shared = extractSharedMeasureIngredients(source)
        val result = shared.first.toMutableList()
        source = shared.second

        val (trailingIngredient, sourceAfterTrailing) = extractTrailingQuantityIngredient(source, hasIngredientContext)
        if (trailingIngredient != null) {
            result.add(trailingIngredient)
            source = sourceAfterTrailing
        }

        val matches = quantityPattern.findAll(source).toList()
        if (matches.isEmpty()) {
            // Unmeasured ingredients are useful too: "add salt and pepper". We only
            // attempt them when the chef used ingredient/action language so ordinary
            // method sentences don't become ingredient rows.
            if (!allowUnmeasured && !hasStrongUnmeasuredContext) return result
            return result + extractUnmeasuredIngredients(source)
        }

        matches.forEachIndexed { index, match ->
            val end = matches.getOrNull(index + 1)?.range?.first ?: source.length
            var chunk = source.substring(match.range.first, end)
                .trim()
                .replace(Regex("(?i)\\s+and\\s*$"), "")
                .trim(',', ' ', '-')
            chunk = trimIngredientTail(chunk)
            if (chunk.isBlank()) return@forEachIndexed

            val parsed = IngredientParser.parse(chunk)
            val name = cleanIngredientName(parsed.name)
            val quantityToken = match.value.trim().lowercase()
            val unsafeBareArticle = quantityToken in setOf("a", "an") &&
                parsed.unit.isBlank() &&
                !hasIngredientContext
            val outputCount = parsed.unit.isBlank() &&
                methodOutputCountContext.containsMatchIn(normalizedRaw)

            // Measured/count ingredients are allowed even if recognition lost the
            // preceding word "add", but a bare article inside a method sentence
            // ("as if it was a burger patty") is not ingredient evidence.
            if (!unsafeBareArticle && !outputCount && isValidIngredientName(name)) {
                result.add(parsed.copy(name = capitalizeIngredient(name)))
            }
        }
        return result
    }

    private fun extractSharedMeasureIngredients(value: String): Pair<List<Ingredient>, String> {
        val quantitySource =
            "(?:(?:\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\\s+and\\s+(?:a\\s+|one\\s+)?(?:half|quarter)|" +
            "\\d+\\s+\\d+/\\d+|(?:one|two|three)\\s+(?:halves|thirds|quarters|fourths)|(?:half|quarter)\\s+(?:of\\s+)?a|a\\s+(?:half|quarter)|" +
            "\\d+/\\d+|\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|half|quarter|couple|dozen|a|an)"
        val unitSource =
            "(?:tablespoon(?:ful)?s?|teaspoon(?:ful)?s?|tbsp|tsp|cupfuls?|cups?|chunks?|grams?|kilograms?|milligrams?|ounces?|fluid ounces?|pounds?|lbs?|cloves?|cans?|pinches?|dashes?|handfuls?|slices?|pieces?|sticks?|sprigs?|bunches?|heads?|packages?|packets?|jars?|bottles?|boxes?|bags?)"
        val regex = Regex(
            "(?i)\\b($quantitySource)\\s+($unitSource)\\s+(?:each\\s+)?of\\s+([^.;]+?)(?=(?:\\s+(?:then|and then|next|after that)\\s+)|$)"
        )
        val results = mutableListOf<Ingredient>()
        val ranges = mutableListOf<IntRange>()

        regex.findAll(value).forEach { match ->
            val rawNames = match.groupValues[3]
            // "2 tbsp of paprika, 3 tbsp of garlic" is two measured ingredients,
            // not a shared 2-tbsp measure. Let the normal quantity parser handle it.
            if (IngredientParser.containsMeasurementEvidence(rawNames)) return@forEach

            val names = rawNames
                .replace(Regex("(?i)\\s+(?:and\\s+)?(?:cook|stir|mix|bake|simmer|roast|fry|heat|boil|sear)\\b.*$"), "")
                .split(Regex("(?i)\\s*(?:,|\\band\\b)\\s*"))
                .map(::cleanIngredientName)
                .filter(::isValidIngredientName)

            if (names.size >= 2) {
                val seed = IngredientParser.parse("${match.groupValues[1]} ${match.groupValues[2]} placeholder")
                names.forEach { name ->
                    results.add(seed.copy(name = capitalizeIngredient(name)))
                }
                ranges.add(match.range)
            }
        }

        if (ranges.isEmpty()) return results to value

        var remainder = value
        ranges.asReversed().forEach { range ->
            remainder = remainder.removeRange(range.first, range.last + 1)
        }
        return results to remainder.replace(Regex("\\s+"), " ").trim()
    }

    // 0909b: ASR sometimes narrates the quantity after the ingredient name instead of
    // before it -- "you're going to need your favorite Dorito chips, one bag" trails
    // the measure behind a comma. The general quantity scan below starts each chunk at
    // its first quantity match, so without this narrow pass the "Dorito chips" text
    // before that comma is silently discarded rather than misparsed. It only fires
    // with real ingredient/action evidence already found in the sentence, and only for
    // the single "name, quantity unit" shape anchored to the end of the source -- it
    // never touches the ordinary leading-quantity case, which the ranges below still
    // parse as they always have.
    private fun extractTrailingQuantityIngredient(
        value: String,
        hasIngredientContext: Boolean
    ): Pair<Ingredient?, String> {
        if (!hasIngredientContext) return null to value
        val quantitySource =
            "(?:(?:\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\\s+and\\s+(?:a\\s+|one\\s+)?(?:half|quarter)|" +
            "\\d+\\s+\\d+/\\d+|(?:one|two|three)\\s+(?:halves|thirds|quarters|fourths)|(?:half|quarter)\\s+(?:of\\s+)?a|a\\s+(?:half|quarter)|" +
            "\\d+/\\d+|\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|half|quarter|couple|dozen|a|an)"
        val unitSource =
            "(?:tablespoon(?:ful)?s?|teaspoon(?:ful)?s?|tbsp|tsp|cupfuls?|cups?|chunks?|grams?|kilograms?|milligrams?|ounces?|fluid ounces?|pounds?|lbs?|cloves?|cans?|pinches?|dashes?|handfuls?|slices?|pieces?|sticks?|sprigs?|bunches?|heads?|packages?|packets?|jars?|bottles?|boxes?|bags?)"
        val regex = Regex("(?i)^(.+?),\\s*($quantitySource)\\s+($unitSource)\\s*$")
        val match = regex.find(value) ?: return null to value

        val name = cleanIngredientName(match.groupValues[1])
        if (!isValidIngredientName(name)) return null to value

        val seed = IngredientParser.parse("${match.groupValues[2]} ${match.groupValues[3]} placeholder")
        val remainder = value.removeRange(match.range).replace(Regex("\\s+"), " ").trim()
        return seed.copy(name = capitalizeIngredient(name)) to remainder
    }

    private fun extractUnmeasuredIngredients(value: String): List<Ingredient> {
        val cleaned = trimIngredientTail(value)
            .replace(Regex("(?i)^(?:of\\s+)+(?:the\\s+)?"), "")
            .trim()
        if (cleaned.isBlank()) return emptyList()

        return cleaned
            .split(Regex("(?i)\\s*(?:,|\\band\\b)\\s*"))
            .map { cleanIngredientName(it) }
            .filter { isValidIngredientName(it, maxLength = 60) }
            .map { Ingredient(name = capitalizeIngredient(it)) }
    }

    private fun cleanIngredientName(value: String): String {
        var cleaned = value
            .replace(Regex("(?i)^(?:of\\s+)+(?:the\\s+)?"), "")
            .replace(Regex("(?i)^(?:and|then|also)\\s+"), "")
            // 0909: "need some sour cream" leaves "some sour cream" once the verb is
            // stripped. Only the bare determiner goes; the ingredient text is never
            // rewritten. "Some" alone is still caught by ingredientNoiseName.
            .replace(Regex("(?i)^some\\s+(?=\\S)"), "")
            // 0909b: same treatment for "need your favorite Dorito chips" -- only the
            // determiner "your" goes, the descriptive text that follows is kept as-is.
            .replace(Regex("(?i)^your\\s+(?=\\S)"), "")
            .replace(Regex("(?i)\\s+(?:and|then|also)$"), "")

        // ASR sometimes joins the next measured ingredient onto the previous one:
        // "2 lb ground beef tablespoon of salt". Keep the first ingredient as
        // the parser boundary and allow the next quantity pass to capture salt.
        cleaned = cleaned.replace(
            Regex("(?i)\\s+(?:tablespoons?|tbsp|teaspoons?|tsp|cups?)\\s+(?:of\\s+)?[a-z].*$"),
            ""
        )

        // v8.5: do not keep preparation-only outputs as ingredients.
        // "make four patties" is a method action, not an ingredient.
        cleaned = cleaned.replace(
            Regex("(?i)^\\d+\\s+(?:patties?|pieces?|portions?|servings?)$"),
            ""
        )

        return cleaned
            .replace(Regex("\\s+"), " ")
            .trim(' ', ',', '.', ';', ':', '-')
    }

    private fun trimIngredientTail(value: String): String {
        return value
            .replace(
                Regex("(?i)\\s+(?:and\\s+)?(?:cook|stir|whisk|mix|saute|sauté|bake|simmer|roast|fry|heat|boil|sear|reduce|rest)\\b.*$"),
                ""
            )
            .replace(
                Regex("(?i)\\s+(?:to|into)\\s+(?:the\\s+|a\\s+|an\\s+)?(?:pan|pot|bowl|skillet|tray|dish|mixture|oven)\\b.*$"),
                ""
            )
            .replace(Regex("(?i)\\s+until\\b.*$"), "")
            .replace(Regex("(?i)\\s+for\\s+(?:about\\s+)?\\d+(?:\\.\\d+)?\\s*(?:seconds?|minutes?|hours?)?\\b.*$"), "")
            .replace(Regex("(?i)[,;]\\s*(?:oh|oops|uh|um|actually|sorry)\\b.*$"), "")
            .replace(Regex("(?i)\\s+(?:oh\\s+(?:shit|s\\*+)|oops|uh|um|sorry)\\b.*$"), "")
            .replace(Regex("(?i)\\s+(?:actually\\s+(?:make\\s+that|use)|make\\s+that|change\\s+that\\s+to|correction)\\b.*$"), "")
            .replace(Regex("(?i)\\s+(?:actually\\s+)?scratch\\s+that\\s*$"), "")
            .replace(Regex("(?i)\\s+(?:i|you|we)\\s+(?:could|would|should|might|may|can)\\s*$"), "")
            .replace(Regex("(?i)\\s+(?:i|you|we)\\s+(?:want|need|like|mean|think)\\s*$"), "")
            .replace(Regex("(?i)\\s+(?:it|that|this)\\s+(?:took|takes)\\s*$"), "")
            .replace(Regex("(?i)\\s+(?:like|wait|actually|sorry|no)\\s*$"), "")
            .replace(Regex("(?i)\\s+(?:(?:i|you|we)(?:'m|'re| am| are)?\\s+)?(?:gonna|going\\s+to)\\s*$"), "")
            // 0.5.5 PWA parity: a window join can attach a whole next sentence after
            // "and": "...salt and you're going to let it [simmer]" -- the verb itself
            // often lands in its own clause via the action-word boundary above,
            // leaving this shell with nothing left to match on. Strip it as its own
            // dangling unit. The "going to"/"gonna" is optional because chefs equally
            // say the plain present tense, "...1 tsp of pepper, and you let it cook
            // for 2 minutes".
            .replace(Regex("(?i)\\s+and\\s+(?:(?:i|you|we)(?:'m|'re| am| are)?\\s+)?(?:(?:going\\s+to|gonna)\\s+)?let\\s+(?:it|them)\\s*$"), "")
            // "salt or" said just before a segment break leaves a dangling "or" with
            // its second option in the next segment; never a real ingredient tail.
            .replace(Regex("(?i)\\s+or\\s*$"), "")
            .replace(Regex("(?i)\\s+(?:on|in|at|to|into|with|for)\\s*$"), "")
            .trim(' ', ',', '.', ';')
    }

    private fun looksLikeOnlyCookingInstruction(name: String): Boolean {
        val words = name.lowercase().split(Regex("[^a-zA-ZÀ-ÿ]+" )).filter { it.isNotBlank() }
        return words.isNotEmpty() && words.all { it in actionWords }
    }

    private fun isValidIngredientName(name: String, maxLength: Int = 80): Boolean {
        val clean = name.trim()
        if (clean.isBlank() || clean.length > maxLength) return false
        if (cookingOnlyNames.matches(clean)) return false
        if (temperatureOnlyName.matches(clean)) return false
        if (ingredientNoiseName.matches(clean)) return false
        if (ingredientArtifactName.matches(clean)) return false
        if (backReferenceName.containsMatchIn(clean)) return false
        if (narrationNoiseName.containsMatchIn(clean)) return false
        if (looksLikeOnlyCookingInstruction(clean)) return false
        if (bareModifierName.matches(clean)) return false
        // v8.5: bare prep nouns are method outputs, not ingredients.
        if (Regex("(?i)^(?:\\d+\\s+)?(?:patties?|portions?|servings?)$").matches(clean)) return false
        return true
    }

    private fun normalizeMethodTemperaturePreposition(value: String): String {
        return methodTemperatureAfterFor.replace(value) { match ->
            val verb = match.groupValues[1]
            val middle = match.groupValues[2].trimEnd()
            val temperature = match.groupValues[3]
            "$verb$middle at $temperature"
        }
    }

    private fun cleanStep(raw: String): String {
        val cleaned = raw
            .trim()
            .replace(Regex("(?i)^(?:(?:okay|ok|so|now|alright|all right)[, ]+)+"), "")
            .replace(Regex("(?i)^(?:and\\s+)?when\\s+(?:it(?:'s| is)|they(?:'re| are))\\s+done,\\s*"), "")
            .replace(Regex("(?i)^(?:and\\s+)?(?:(?:i|you|we)(?:'m|'re| am| are)?\\s+)?(?:going\\s+to|gonna)\\s+"), "")
            .replace(Regex("(?i)\\s+(?:(?:i|you|we)(?:'m|'re| am| are)?\\s+)?(?:gonna|going\\s+to)\\s*$"), "")
            .replace(Regex("(?i)\\b(\\d+)\\s+(minutes?|seconds?|hours?)\\s+\\1\\s*$"), "$1 $2")
            .replace(Regex("\\s+"), " ")
            .trim(' ', ',', '.', ';', ':')
        return normalizeMethodTemperaturePreposition(cleaned)
    }

    private fun collectSegmentAwareSteps(normalizedSegments: List<String>): List<String> {
        val result = mutableListOf<String>()
        var acceptsIngredientContinuation = false

        normalizedSegments.forEach { segment ->
            val segmentIngredients = mutableListOf<Ingredient>()
            val orderedCandidates = mutableListOf<Pair<String, Boolean>>()
            var hasRecognizedMethod = false

            splitNarration(segment).forEach { clause ->
                val clauseIngredients = mutableListOf<Ingredient>()
                val clauseSteps = mutableListOf<String>()
                parseNarration(clause, clauseIngredients, clauseSteps, collectSteps = true)
                segmentIngredients.addAll(clauseIngredients)

                if (clauseSteps.isNotEmpty()) {
                    hasRecognizedMethod = true
                    clauseSteps.forEach { orderedCandidates.add(it to true) }
                } else {
                    val cleanedClause = cleanStep(clause)
                    if (cleanedClause.length >= 4 && uncertainThemClause.containsMatchIn(cleanedClause)) {
                        orderedCandidates.add(sentenceCase(cleanedClause) to false)
                    }
                }
            }

            if (hasRecognizedMethod) {
                orderedCandidates.forEach { (candidate, recognized) ->
                    if (recognized || uncertainThemClause.containsMatchIn(candidate)) result.add(candidate)
                }
                acceptsIngredientContinuation = ingredientMethodContinuationAction.containsMatchIn(cleanStep(segment))
                return@forEach
            }

            val cleaned = cleanStep(segment)
            if (acceptsIngredientContinuation &&
                segmentIngredients.isNotEmpty() &&
                !ingredientDeclarationSegment.containsMatchIn(segment) &&
                cleaned.length >= 2 &&
                result.isNotEmpty()
            ) {
                val continuation = cleaned.replaceFirstChar { if (it.isUpperCase()) it.lowercase() else it.toString() }
                val previous = result.removeAt(result.lastIndex).trimEnd('.', '!', '?')
                result.add(sentenceCase("$previous $continuation"))
                return@forEach
            }
            if (segmentIngredients.isNotEmpty()) return@forEach

            if (cleaned.length >= 4 && durationOnlyMethodContinuation.matches(cleaned) && result.isNotEmpty()) {
                val previous = result.last().trimEnd('.', '!', '?')
                val alreadyHasDuration = Regex("(?i)\b(?:seconds?|minutes?|hours?)\b").containsMatchIn(previous)
                if (durationAttachableMethod.containsMatchIn(previous) && !alreadyHasDuration) {
                    val continuation = if (cleaned.startsWith("for ", ignoreCase = true)) {
                        cleaned.replaceFirstChar { if (it.isUpperCase()) it.lowercase() else it.toString() }
                    } else {
                        "for " + cleaned.replaceFirstChar { if (it.isUpperCase()) it.lowercase() else it.toString() }
                    }
                    result[result.lastIndex] = sentenceCase("$previous $continuation")
                    acceptsIngredientContinuation = false
                    return@forEach
                }
            }

            if (cleaned.length >= 4 && methodContinuationCue.containsMatchIn(cleaned)) {
                result.add(sentenceCase(cleaned))
                acceptsIngredientContinuation = false
                return@forEach
            }

            if (cleaned.isNotBlank()) acceptsIngredientContinuation = false
        }

        return result
    }

    private fun dedupeIngredients(values: List<Ingredient>): List<Ingredient> {
        val result = mutableListOf<Ingredient>()
        val exactSeen = linkedSetOf<String>()

        values.forEach { ingredient ->
            val cleanName = cleanIngredientName(ingredient.name)
            if (cleanName.isBlank()) return@forEach
            val normalizedIngredient = ingredient.copy(name = capitalizeIngredient(cleanName))
            val exactKey = listOf(
                normalizedIngredient.quantity,
                normalizedIngredient.unit,
                normalizedIngredient.name
            ).joinToString("|").lowercase().replace(Regex("\\s+"), " ")

            if (exactSeen.add(exactKey)) result.add(normalizedIngredient)
        }
        return result
    }


    private fun buildStructuredIngredientActionStep(
        raw: String,
        localIngredients: List<Ingredient>
    ): String? {
        val actionMatch = Regex(
            "(?i)^\\s*(?:(?:uh|um)\\s+)?(?:add|adding|use|using|season(?:ing)?\\s+with|sprinkle)\\b"
        ).find(raw) ?: return null

        val shouldStructure =
            Regex("(?i)\\b(?:actually\\s+)?scratch\\s+that\\b").containsMatchIn(raw)

        if (!shouldStructure || localIngredients.isEmpty()) return null

        val corrected = dedupeIngredients(
            applyCorrections(raw, dedupeIngredients(localIngredients))
        )
        if (corrected.isEmpty()) return null

        val verb = when {
            actionMatch.value.contains("season", ignoreCase = true) -> "Season with"
            actionMatch.value.contains("sprinkle", ignoreCase = true) -> "Sprinkle"
            actionMatch.value.contains("use", ignoreCase = true) -> "Use"
            else -> "Add"
        }

        val rendered = corrected.map(::ingredientForStep)
        val listText = when (rendered.size) {
            1 -> rendered.first()
            2 -> "${rendered[0]} and ${rendered[1]}"
            else -> rendered.dropLast(1).joinToString(", ") + ", and " + rendered.last()
        }
        return "$verb $listText"
    }

    private fun ingredientForStep(item: Ingredient): String {
        val parts = mutableListOf<String>()
        if (item.quantity.isNotBlank()) parts += item.quantity
        if (item.unit.isNotBlank()) parts += item.unit
        if (item.name.isNotBlank()) {
            val name = item.name.trim().replaceFirstChar {
                if (it.isUpperCase()) it.lowercase() else it.toString()
            }
            parts += name
        }
        return parts.joinToString(" ").trim()
    }

    private fun normalizedIngredientName(value: String): String =
        cleanIngredientName(value)
            .lowercase()
            .replace(Regex("[^a-z0-9]+"), " ")
            .trim()

    private fun applyNamedIngredientCorrection(
        corrected: MutableList<Ingredient>,
        quantity: String,
        unit: String,
        rawName: String
    ) {
        val parsed = IngredientParser.parse("$quantity $unit ${trimIngredientTail(rawName)}")
        val correctedName = cleanIngredientName(parsed.name)
        val targetKey = normalizedIngredientName(correctedName)
        if (targetKey.isBlank()) return

        val matching = corrected.indices.filter {
            normalizedIngredientName(corrected[it].name) == targetKey
        }
        if (matching.isNotEmpty()) {
            val keep = matching.last()
            corrected[keep] = corrected[keep].copy(
                quantity = parsed.quantity,
                unit = parsed.unit,
                name = capitalizeIngredient(correctedName)
            )
            matching.filter { it != keep }.asReversed().forEach(corrected::removeAt)
        } else if (isValidIngredientName(correctedName)) {
            corrected += parsed.copy(name = capitalizeIngredient(correctedName))
        }
    }

    private fun applyCorrections(fullTranscript: String, values: List<Ingredient>): List<Ingredient> {
        if (values.isEmpty()) return values

        val quantitySource =
            "(?:(?:\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\\s+and\\s+(?:a\\s+|one\\s+)?(?:half|quarter)|" +
            "\\d+\\s+\\d+/\\d+|(?:one|two|three)\\s+(?:halves|thirds|quarters|fourths)|(?:half|quarter)\\s+(?:of\\s+)?a|a\\s+(?:half|quarter)|" +
            "\\d+/\\d+|\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|half|quarter|couple|dozen|a|an)"
        val unitSource =
            "(?:tablespoon(?:ful)?s?|teaspoon(?:ful)?s?|tbsp|tsp|cupfuls?|cups?|chunks?|grams?|kilograms?|milligrams?|ounces?|fluid ounces?|pounds?|lbs?|cloves?|cans?|pinches?|dashes?|handfuls?|slices?|pieces?|sticks?|sprigs?|bunches?|heads?|packages?|packets?|jars?|bottles?|boxes?|bags?)"

        val corrected = values.toMutableList()

        // Named correction: "one chunk chicken breast, actually scratch that,
        // half a chunk chicken breast". We collapse every parser/window duplicate
        // for that same ingredient into one final corrected row.
        val scratchRegex = Regex(
            "(?i)\\b(?:actually\\s+)?scratch\\s+that\\s+($quantitySource)\\s+($unitSource)\\s+(?:of\\s+)?(.+?)(?=(?:\\s+$quantitySource\\s+$unitSource\\b)|(?:\\s+(?:and\\s+then|but\\s+then|then|next|after\\s+that)\\b)|[.;]|$)"
        )

        scratchRegex.findAll(fullTranscript).forEach { match ->
            applyNamedIngredientCorrection(
                corrected,
                match.groupValues[1],
                match.groupValues[2],
                match.groupValues[3]
            )
        }

        // Natural correction cue captured by the real Android test:
        // "1 lb ground beef, wait, 2 lb ground beef". The cue only acts as a
        // correction when it is immediately followed by another measured item.
        val correctionFiller =
            "(?:(?:(?:we|you)(?:'re| are)|i(?:'m| am))\\s+(?:going\\s+to|gonna)\\s+(?:do|add|use|put|get)\\s+|(?:then\\s+)?(?:do|add|use|put|get)\\s+)?"
        val waitCorrectionRegex = Regex(
            "(?i)\\b(?:oh\\s+)?(?:wait(?:[, ]+no)?|no|sorry|actually\\s+no|oops)[,.; ]+$correctionFiller($quantitySource)\\s+($unitSource)\\s+(?:of\\s+)?(.+?)(?=(?:\\s+$quantitySource\\s+$unitSource\\b)|(?:\\s+(?:and\\s+then|but\\s+then|then|next|after\\s+that)\\b)|[.;]|$)"
        )
        waitCorrectionRegex.findAll(fullTranscript).forEach { match ->
            applyNamedIngredientCorrection(
                corrected,
                match.groupValues[1],
                match.groupValues[2],
                match.groupValues[3]
            )
        }

        // Existing quantity/unit-only correction language.
        val correctionRegex = Regex(
            "(?i)\\b(?:actually\\s+(?:make\\s+that|use)|make\\s+that|change\\s+that\\s+to|correction[, ]*)\\s*($quantitySource)\\s+($unitSource)\\b"
        )

        correctionRegex.findAll(fullTranscript).forEach { match ->
            val parsed = IngredientParser.parse("${match.groupValues[1]} ${match.groupValues[2]} placeholder")
            for (index in corrected.indices.reversed()) {
                if (canonicalUnit(corrected[index].unit) == canonicalUnit(parsed.unit)) {
                    corrected[index] = corrected[index].copy(
                        quantity = parsed.quantity,
                        unit = parsed.unit
                    )
                    break
                }
            }
        }
        return corrected
    }

    private fun canonicalUnit(raw: String): String {
        if (raw.isBlank()) return ""
        return IngredientParser.parse("1 $raw placeholder").unit.ifBlank { raw.lowercase() }
    }

    private fun dedupeSteps(values: List<String>): List<String> {
        val seen = linkedSetOf<String>()
        val out = mutableListOf<String>()

        values.forEach { step ->
            val key = step.lowercase().replace(Regex("[^a-z0-9]+"), " ").trim()
            if (key.isBlank() || key in seen) return@forEach

            val lastKey = out.lastOrNull()
                ?.lowercase()
                ?.replace(Regex("[^a-z0-9]+"), " ")
                ?.trim()
                .orEmpty()

            if (lastKey.isNotBlank() && lastKey.split(" ").size >= 3 && key.startsWith("$lastKey ")) {
                seen.remove(lastKey)
                out[out.lastIndex] = step
                seen.add(key)
                return@forEach
            }
            if (lastKey.isNotBlank() && key.split(" ").size >= 3 && lastKey.startsWith("$key ")) {
                return@forEach
            }

            seen.add(key)
            out.add(step)
        }
        return out
    }

    private fun capitalizeIngredient(value: String): String {
        val trimmed = value.trim().trimEnd('.', ',', ';')
        return trimmed.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
    }

    private fun sentenceCase(value: String): String {
        val trimmed = value.trim()
        if (trimmed.isBlank()) return trimmed
        val capped = trimmed.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
        return if (capped.lastOrNull() in listOf('.', '!', '?')) capped else "$capped."
    }
}
