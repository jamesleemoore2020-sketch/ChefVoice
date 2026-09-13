package com.chefvoice.app.voice

import com.chefvoice.app.model.Ingredient
import com.chefvoice.app.model.TranscriptSegment

data class CookingDraft(
    val ingredients: List<Ingredient>,
    val steps: List<String>
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
        "(?i)^(?:to|of|the|it|this|that|some|what|today|tomorrow|we|you|i|and|then|so|um|uh)$"
    )

    private val ingredientArtifactName = Regex("(?i)^(?:grab|stuff|tasteful)$")

    private val narrationNoiseName = Regex(
        "(?i)^(?:today|so|what|you|we|i)\\b.*\\b(?:gonna|going|need|make|do)\\b"
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

    fun parse(segments: List<TranscriptSegment>): CookingDraft {
        if (segments.isEmpty()) return CookingDraft(emptyList(), emptyList())

        val normalized = segments
            .map { IngredientParser.normalizeSpeechText(it.text).trim() }
            .filter { it.isNotBlank() }

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
        return CookingDraft(
            // Canonicalization is part of the parsed recipe boundary. The UI and
            // later review passes should never receive obvious ASR tails as
            // ingredient identity.
            ingredients = RecipeCanonicalizer.canonicalizeIngredients(correctedIngredients),
            steps = dedupeSteps(steps)
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
                    "(?i)^(?:(?:i|you|we)(?:'m|'re|'ll| am| are| will)?\\s+)?(?:(?:am|are)\\s+)?(?:going\\s+to\\s+|gonna\\s+|want\\s+to\\s+|will\\s+)?(?:add|adding|use|using|pour(?:ing)?(?:\\s+in)?|stir(?:ring)?\\s+in|mix(?:ing)?\\s+in|put(?:ting)?\\s+in|throw(?:ing)?\\s+in|drop(?:ping)?\\s+in|fold(?:ing)?\\s+in|need|take|season(?:ing)?\\s+with|sprinkle|top(?:ping)?\\s+with|combine)\\s+"
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
