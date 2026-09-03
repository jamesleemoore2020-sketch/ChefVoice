package com.chefvoice.app.voice

import com.chefvoice.app.model.Ingredient
import com.chefvoice.app.model.SecondPassIssue
import com.chefvoice.app.model.SecondPassMethodIssue
import com.chefvoice.app.model.SecondPassResult
import com.chefvoice.app.model.TranscriptSegment
import kotlin.math.max

object SecondPassReviewer {
    private val prepWords = setOf(
        "diced", "chopped", "minced", "sliced", "crushed", "fresh",
        "large", "small", "medium", "finely", "roughly", "peeled", "grated",
        "ground", "freshly", "whole", "cracked", "rough", "roughly", "thin", "thick"
    )

    // Safe comparison-only aliases. These never modify saved recipe text.
    private val ingredientAliases = mapOf(
        "scallions" to "green onions",
        "scallion" to "green onion",
        "cilantro" to "coriander",
        "garbanzo" to "chickpea",
        "garbanzos" to "chickpeas",
        "aubergine" to "eggplant",
        "courgette" to "zucchini"
    )

    private val actionOnlyWords = setOf(
        "add", "adding", "use", "using", "pour", "pouring", "stir", "stirring",
        "mix", "mixing", "put", "putting", "throw", "throwing", "drop", "dropping",
        "fold", "folding", "season", "seasoning", "sprinkle", "combine"
    )

    private val methodTokenAliases = mapOf(
        "one" to "1", "two" to "2", "three" to "3", "four" to "4", "five" to "5",
        "six" to "6", "seven" to "7", "eight" to "8", "nine" to "9", "ten" to "10",
        "tablespoon" to "tbsp", "tablespoons" to "tbsp", "tbsps" to "tbsp",
        "teaspoon" to "tsp", "teaspoons" to "tsp", "tsps" to "tsp",
        "pound" to "lb", "pounds" to "lb", "lbs" to "lb",
        "ounce" to "oz", "ounces" to "oz", "ozs" to "oz",
        "minute" to "min", "minutes" to "min", "mins" to "min",
        "second" to "sec", "seconds" to "sec", "secs" to "sec",
        "hour" to "hr", "hours" to "hr", "hrs" to "hr",
        "degree" to "degree", "degrees" to "degree"
    )

    private val methodStopWords = setOf("the", "a", "an", "of", "and")

    private val methodActionWords = setOf(
        "add", "bake", "blend", "boil", "brown", "chop", "combine", "cook", "cut", "divide", "drain",
        "flip", "fold", "fry", "grill", "knead", "make", "marinate", "mix", "pack", "pat", "pour",
        "preheat", "reduce", "rest", "roast", "saute", "season", "sear", "serve", "shake", "shape",
        "simmer", "slice", "split", "sprinkle", "stir", "toss", "whisk"
    )

    // Comparison-only cooking action groups. These prevent false review warnings when
    // chefs use natural variations of the same action.
    private val methodActionAliases = mapOf(
        "put" to "transfer",
        "place" to "transfer",
        "move" to "transfer",
        "transfer" to "transfer",
        "insert" to "transfer",
        "bake" to "heat",
        "roast" to "heat",
        "cook" to "heat",
        "grill" to "heat",
        "broil" to "heat",
        "fry" to "heat",
        "combine" to "mix",
        "blend" to "mix",
        "whisk" to "mix"
    )

    data class Review(
        val issues: List<SecondPassIssue>,
        val confirmedCount: Int
    )

    data class MethodReview(
        val issues: List<SecondPassMethodIssue>,
        val confirmedCount: Int
    )

    private data class MethodCandidate(
        val secondIndex: Int,
        val key: String,
        val text: String,
        val preferredLiveIndex: Int = -1
    )

    fun fromCloudTranscript(
        liveIngredients: List<Ingredient>,
        liveSteps: List<String> = emptyList(),
        transcript: String,
        rawSegments: List<String>,
        provider: String = "google-cloud-speech-v2",
        model: String = "chirp_3",
        ranAt: Long = System.currentTimeMillis()
    ): SecondPassResult {
        val segmentTexts = rawSegments.map { it.trim() }.filter { it.isNotBlank() }
            .ifEmpty { listOf(transcript.trim()).filter { it.isNotBlank() } }
        val parserSegments = segmentTexts.mapIndexed { index, text ->
            TranscriptSegment(elapsedMs = index * 1000L, text = text)
        }
        val parsed = CookingSessionParser.parse(parserSegments)
        val canonicalSecondIngredients = RecipeCanonicalizer.canonicalizeIngredients(parsed.ingredients)
        val ingredientReview = buildReview(
            RecipeCanonicalizer.canonicalizeIngredients(liveIngredients),
            canonicalSecondIngredients
        )
        val methodReview = buildMethodReview(liveSteps, parsed.steps, transcript)
        return SecondPassResult(
            provider = provider,
            model = model,
            transcript = transcript.trim(),
            ingredients = canonicalSecondIngredients,
            issues = ingredientReview.issues,
            confirmedCount = ingredientReview.confirmedCount,
            steps = parsed.steps,
            methodIssues = methodReview.issues,
            methodConfirmedCount = methodReview.confirmedCount,
            ranAt = ranAt
        )
    }

    private fun isCookingFactIngredient(item: Ingredient): Boolean {
        val raw = listOf(item.quantity, item.unit, item.name)
            .filter { it.isNotBlank() }
            .joinToString(" ")
            .trim()
        return raw.matches(Regex("(?i)^\\d+(?:\\.\\d+)?\\s*(?:°(?:\\s*[fc])?|degrees?(?:\\s+(?:fahrenheit|celsius))?)$")) ||
            raw.matches(Regex("(?i)^\\d+(?:\\.\\d+)?\\s*(?:seconds?|minutes?|hours?)$"))
    }

    fun buildReview(
        liveIngredients: List<Ingredient>,
        secondIngredients: List<Ingredient>
    ): Review {
        val issues = mutableListOf<SecondPassIssue>()
        val usedLive = mutableSetOf<Int>()
        var confirmed = 0

        secondIngredients.forEachIndexed { secondIndex, second ->
            if (isCookingFactIngredient(second)) return@forEachIndexed
            val classifiedMatch = IngredientReviewClassifier.classify(
                liveIngredients,
                secondIngredients
            ).secondMatches[secondIndex]

            val bestIndex = classifiedMatch?.liveIndex ?: -1
            val bestScore = classifiedMatch?.score ?: 0.0

            if (bestIndex >= 0 && bestScore >= 0.66) {
                usedLive += bestIndex
                val live = liveIngredients[bestIndex]
                if (sameMeasure(live, second)) {
                    val cleanedLive = cleanupKnownAsrTail(live.name, live.unit)
                    val hadKnownJunk = cleanedLive.lowercase() != live.name.trim().lowercase()
                    if (hadKnownJunk) {
                        issues += SecondPassIssue(
                            id = "name-cleanup:$bestIndex:$secondIndex",
                            type = "ingredient-name-cleanup",
                            title = "Clean up ingredient name",
                            detail = "Live capture: ${display(live)} · Second pass: ${display(second)}",
                            liveIndex = bestIndex,
                            secondIndex = secondIndex,
                            suggested = second,
                            confidence = 0.75
                        )
                    } else {
                        confirmed++
                    }
                } else {
                    issues += SecondPassIssue(
                        id = "measurement:$bestIndex:$secondIndex",
                        type = "quantity-change",
                        title = "Quantity changed",
                        detail = "Live capture: ${display(live)} · Second pass: ${display(second)}",
                        liveIndex = bestIndex,
                        secondIndex = secondIndex,
                        suggested = second,
                        confidence = 0.85
                    )
                }
            } else {
                issues += SecondPassIssue(
                    id = "missing:$secondIndex",
                    type = "possible-missed-ingredient",
                    title = "Possible missed ingredient",
                    detail = "Second pass heard: ${display(second)}",
                    liveIndex = -1,
                    secondIndex = secondIndex,
                    suggested = second,
                    confidence = 0.75
                )
            }
        }

        liveIngredients.forEachIndexed { liveIndex, live ->
            if (liveIndex in usedLive || isActionOnly(live)) return@forEachIndexed
            if (ingredientReviewConfidence(live, secondIngredients) < 0.55) return@forEachIndexed
            val superseding = secondIngredients.firstOrNull { second ->
                nameKey(live) == nameKey(second) && !sameMeasure(live, second)
            }
            val likelyArtifact = superseding != null || isLikelyParserArtifact(live, secondIngredients)
            val confidence = ingredientReviewConfidence(live, secondIngredients)
            if (!likelyArtifact && confidence < 0.45) return@forEachIndexed
            issues += SecondPassIssue(
                id = if (likelyArtifact) "artifact:$liveIndex" else "live-only:$liveIndex",
                type = if (likelyArtifact) "remove-live-artifact" else "live-only-low-confidence",
                title = when {
                    superseding != null -> "Superseded quantity"
                    likelyArtifact -> "Likely capture artifact"
                    else -> "Live-only ingredient"
                },
                detail = when {
                    superseding != null -> "Live capture kept ${display(live)}, but the second pass corrected the same ingredient to ${display(superseding)}."
                    likelyArtifact -> "Live capture created ${display(live)}, but the cleaner second pass did not confirm it."
                    else -> "Live capture heard ${display(live)}, but the second pass did not confirm it."
                },
                liveIndex = liveIndex,
                secondIndex = -1,
                suggested = null,
                confidence = if (likelyArtifact) 0.90 else 0.72
            )
        }

        return Review(issues = issues, confirmedCount = confirmed)
    }

    fun applySuggestion(
        ingredients: List<Ingredient>,
        issue: SecondPassIssue
    ): List<Ingredient> {
        val next = ingredients.toMutableList()
        when (issue.type) {
            "possible-missed-ingredient" -> {
                issue.suggested?.let { suggested ->
                    next += suggested.copy(id = suggested.id.ifBlank { java.util.UUID.randomUUID().toString() })
                }
            }
            // "measurement-disagreement" is the legacy name for "quantity-change".
            // Reviews persisted locally by older builds still carry it, so keep it accepted.
            "measurement-disagreement", "quantity-change", "ingredient-name-cleanup" -> {
                if (issue.liveIndex in next.indices && issue.suggested != null) {
                    val current = next[issue.liveIndex]
                    val suggested = issue.suggested
                    next[issue.liveIndex] = current.copy(
                        quantity = suggested.quantity.ifBlank { current.quantity },
                        unit = suggested.unit.ifBlank { current.unit },
                        name = suggested.name.ifBlank { current.name }
                    )
                }
            }
            "remove-live-artifact" -> {
                if (issue.liveIndex in next.indices) next.removeAt(issue.liveIndex)
            }
        }
        return next
    }

    fun buildMethodReview(
        liveSteps: List<String>,
        secondSteps: List<String>,
        sourceTranscript: String = ""
    ): MethodReview {
        val issues = mutableListOf<SecondPassMethodIssue>()
        val usedLive = mutableSetOf<Int>()
        val handledSecond = supersededSecondMethodIndices(secondSteps, sourceTranscript).toMutableSet()
        var confirmed = 0

        // Real-device correction closure: live recognition can collapse an old method and its
        // spoken correction into one row, while the cleaner second pass splits them into two.
        // Pair the live row with the corrected (later) second-pass step and suppress the stale
        // pre-correction second-pass step so we never offer it as a replacement.
        liveSteps.forEachIndexed { liveIndex, liveRaw ->
            val parts = splitMethodCorrection(liveRaw) ?: return@forEachIndexed
            val before = parts.first
            val after = parts.second

            var supersededIndex = -1
            var supersededScore = 0.0
            secondSteps.forEachIndexed { secondIndex, secondRaw ->
                val score = methodSimilarity(before, secondRaw)
                if (score > supersededScore) {
                    supersededScore = score
                    supersededIndex = secondIndex
                }
            }
            if (supersededIndex < 0 || supersededScore < 0.72) return@forEachIndexed

            var correctedIndex = -1
            var correctedScore = 0.0
            secondSteps.forEachIndexed correctedLoop@ { secondIndex, secondRaw ->
                if (secondIndex <= supersededIndex) return@correctedLoop
                val score = methodSimilarity(after, secondRaw)
                if (score > correctedScore) {
                    correctedScore = score
                    correctedIndex = secondIndex
                }
            }
            if (correctedIndex < 0 || correctedScore < 0.56) return@forEachIndexed

            val live = liveRaw.trim()
            val corrected = secondSteps[correctedIndex].trim()
            usedLive += liveIndex
            handledSecond += supersededIndex
            handledSecond += correctedIndex
            issues += SecondPassMethodIssue(
                id = "method-correction:$liveIndex:$correctedIndex",
                type = "method-wording-disagreement",
                title = "Check corrected method",
                detail = "Live method contains a correction: $live · Second pass corrected method: $corrected",
                liveIndex = liveIndex,
                secondIndex = correctedIndex,
                suggestedStep = corrected,
                confidence = correctedScore.coerceIn(0.65, 0.92)
            )
        }

        methodCandidates(liveSteps, secondSteps, handledSecond, usedLive).forEach { candidate ->
            val secondIndex = candidate.secondIndex
            val second = candidate.text
            var bestIndex = -1
            var bestScore = 0.0

            if (candidate.preferredLiveIndex >= 0 && candidate.preferredLiveIndex !in usedLive) {
                val score = methodSimilarity(liveSteps[candidate.preferredLiveIndex], second)
                if (score >= 0.56) {
                    bestIndex = candidate.preferredLiveIndex
                    bestScore = score
                }
            }

            if (bestIndex < 0) {
                liveSteps.forEachIndexed liveLoop@ { liveIndex, liveRaw ->
                    if (liveIndex in usedLive) return@liveLoop
                    val score = methodSimilarity(liveRaw, second)
                    if (score > bestScore) {
                        bestScore = score
                        bestIndex = liveIndex
                    }
                }
            }

            if (bestIndex >= 0 && bestScore >= 0.56) {
                usedLive += bestIndex
                val live = liveSteps[bestIndex].trim()
                if (methodJaccard(live, second) >= 0.86 ||
                    normalizeMethodStep(live) == normalizeMethodStep(second) ||
                    methodMeaningIsContained(live, second)
                ) {
                    // Second Pass often expands terse live notes into a chef-readable
                    // instruction. Extra detail is confirmation, not a disagreement.
                    confirmed++
                } else {
                    issues += SecondPassMethodIssue(
                        id = "method-wording:$bestIndex:${candidate.key}",
                        type = "method-wording-disagreement",
                        title = "Check method wording",
                        detail = "Live method: $live · Second pass: $second",
                        liveIndex = bestIndex,
                        secondIndex = secondIndex,
                        suggestedStep = second,
                        confidence = bestScore.coerceIn(0.60, 0.90)
                    )
                }
            } else {
                issues += SecondPassMethodIssue(
                    id = "method-missing:${candidate.key}",
                    type = "possible-missed-step",
                    title = "Possible missed step",
                    detail = "Second pass heard: $second",
                    liveIndex = -1,
                    secondIndex = secondIndex,
                    suggestedStep = second,
                    confidence = 0.78
                )
            }
        }

        liveSteps.forEachIndexed { liveIndex, liveRaw ->
            if (liveIndex in usedLive) return@forEachIndexed
            val live = liveRaw.trim()
            if (live.isBlank()) return@forEachIndexed
            issues += SecondPassMethodIssue(
                id = "method-live-only:$liveIndex",
                type = "live-only-step",
                title = "Live-only step",
                detail = "Live method: $live · Second pass did not confirm this step.",
                liveIndex = liveIndex,
                secondIndex = -1,
                suggestedStep = null,
                confidence = 0.68
            )
        }

        return MethodReview(issues = issues, confirmedCount = confirmed)
    }


    private fun supersededSecondMethodIndices(
        secondSteps: List<String>,
        sourceTranscript: String
    ): Set<Int> {
        if (secondSteps.size < 2 || sourceTranscript.isBlank()) return emptySet()
        val parts = splitMethodCorrection(sourceTranscript) ?: return emptySet()
        val before = parts.first
        val after = parts.second

        var correctedIndex = -1
        var correctedScore = 0.0
        secondSteps.forEachIndexed { index, step ->
            val score = methodSimilarity(after, step)
            if (score > correctedScore) {
                correctedScore = score
                correctedIndex = index
            }
        }
        if (correctedIndex <= 0 || correctedScore < 0.72) return emptySet()

        val corrected = secondSteps[correctedIndex]
        for (index in correctedIndex - 1 downTo 0) {
            val beforeScore = methodSimilarity(before, secondSteps[index])
            val relatedScore = methodSimilarity(secondSteps[index], corrected)
            if (beforeScore >= 0.56 && relatedScore >= 0.56) {
                return setOf(index)
            }
        }
        return emptySet()
    }

    fun applyMethodSuggestion(
        steps: List<String>,
        issue: SecondPassMethodIssue
    ): List<String> {
        val next = steps.toMutableList()
        when (issue.type) {
            "possible-missed-step" -> issue.suggestedStep?.trim()?.takeIf { it.isNotBlank() }?.let { suggested ->
                val insertAt = issue.secondIndex.coerceIn(0, next.size)
                next.add(insertAt, suggested)
            }
            "method-wording-disagreement" -> {
                if (issue.liveIndex in next.indices && !issue.suggestedStep.isNullOrBlank()) {
                    next[issue.liveIndex] = issue.suggestedStep.trim()
                }
            }
        }
        return next
    }

    private val methodCorrectionCue = Regex(
        "\\b(?:actually(?:\\s+scratch\\s+that)?|scratch\\s+that|oh\\s+wait(?:\\s+no)?|wait|sorry|oops|no)\\b[,:;\\s-]*",
        RegexOption.IGNORE_CASE
    )

    private fun splitMethodCorrection(value: String): Pair<String, String>? {
        val match = methodCorrectionCue.findAll(value).lastOrNull() ?: return null
        val before = value.substring(0, match.range.first).trim(' ', ',', '.', ';', ':', '-')
        val after = value.substring(match.range.last + 1).trim(' ', ',', '.', ';', ':', '-')
        if (before.isBlank() || after.isBlank()) return null
        return before to after
    }

    private val methodDurationCue = Regex(
        "\\b\\d+\\s*(?:second|seconds|sec|secs|minute|minutes|min|mins|hour|hours|hr|hrs)\\b"
    )

    private val methodTemperatureCue = Regex(
        "\\b\\d+\\s*(?:degree|degrees|deg|f|c|fahrenheit|celsius)\\b"
    )

    /**
     * Second Pass routinely expands a terse live note into a chef-readable sentence
     * ("Season" becomes "Season the beef well"). That extra wording is confirmation,
     * not a disagreement, and suppressing it keeps the review list quiet.
     *
     * It is not confirmation when the added words introduce something the chef has to
     * actually do: another cooking action, another duration, or another temperature.
     * "Cook for 20 minutes" to "Cook for 20 minutes, flipping halfway" adds a real
     * instruction and stays a review card, matching the 0.7.5 Method Review contract
     * that "Check method wording" covers materially different steps.
     */
    private fun methodMeaningIsContained(live: String, second: String): Boolean {
        val liveWords = methodWords(live).toSet()
        val secondWords = methodWords(second).toSet()
        if (liveWords.size < 2 || secondWords.size <= liveWords.size) return false
        if (!liveWords.all { it in secondWords }) return false

        val addedWords = secondWords - liveWords
        if (addedWords.any { isMethodActionToken(it) }) return false
        if (cueCount(methodDurationCue, second) > cueCount(methodDurationCue, live)) return false
        if (cueCount(methodTemperatureCue, second) > cueCount(methodTemperatureCue, live)) return false
        return true
    }

    private fun cueCount(cue: Regex, value: String): Int = cue.findAll(value.lowercase()).count()

    /** Matches a cooking action in its bare, -s, -ed or -ing form ("flip", "flipping"). */
    private fun isMethodActionToken(word: String): Boolean {
        if (word in methodActionWords) return true
        val base = when {
            word.endsWith("ing") && word.length > 5 -> word.dropLast(3)
            word.endsWith("ed") && word.length > 4 -> word.dropLast(2)
            word.endsWith("s") && word.length > 3 -> word.dropLast(1)
            else -> return false
        }
        val undoubled = if (base.length > 2 && base[base.length - 1] == base[base.length - 2]) base.dropLast(1) else base
        return base in methodActionWords ||
            undoubled in methodActionWords ||
            "${base}e" in methodActionWords ||
            "${undoubled}e" in methodActionWords
    }

    private fun methodSimilarity(a: String, b: String): Double {
        val leftWords = methodWords(a)
        val rightWords = methodWords(b)
        val leftSet = leftWords.toSet()
        val rightSet = rightWords.toSet()
        if (leftSet.isEmpty() || rightSet.isEmpty()) return 0.0
        if (leftWords.joinToString(" ") == rightWords.joinToString(" ")) return 1.0
        val intersection = leftSet.count { it in rightSet }
        val union = leftSet.size + rightSet.size - intersection
        val jaccard = intersection.toDouble() / max(1, union)
        val coverage = max(
            intersection.toDouble() / max(1, leftSet.size),
            intersection.toDouble() / max(1, rightSet.size)
        )
        var score = max(jaccard, coverage * 0.90)

        val leftAction = leftWords.firstOrNull()
        val rightAction = rightWords.firstOrNull()
        if (
            leftAction != null && rightAction != null &&
            leftAction.length >= 4 && rightAction.length >= 4 &&
            leftAction in methodActionWords && rightAction in methodActionWords &&
            editDistanceAtMostOne(leftAction, rightAction)
        ) {
            val leftTail = leftWords.drop(1).toSet()
            val rightTail = rightWords.drop(1).toSet()
            val tailIntersection = leftTail.count { it in rightTail }
            val tailCoverage = if (leftTail.isEmpty() && rightTail.isEmpty()) {
                1.0
            } else {
                max(
                    tailIntersection.toDouble() / max(1, leftTail.size),
                    tailIntersection.toDouble() / max(1, rightTail.size)
                )
            }
            if (tailCoverage >= 0.50) score = max(score, 0.84)
        }
        return score
    }

    private fun methodJaccard(a: String, b: String): Double {
        val leftSet = methodWords(a).toSet()
        val rightSet = methodWords(b).toSet()
        if (leftSet.isEmpty() || rightSet.isEmpty()) return 0.0
        val intersection = leftSet.count { it in rightSet }
        val union = leftSet.size + rightSet.size - intersection
        return intersection.toDouble() / max(1, union)
    }

    private fun normalizeMethodStep(value: String): String = methodWords(value).joinToString(" ")

    private fun methodWords(value: String): List<String> =
        value.lowercase()
            .replace(Regex("\\b(?:okay|ok|so|now|alright|all right|then|next|after that)\\b"), " ")
            .replace(Regex("[^a-z0-9]+"), " ")
            .trim()
            .split(Regex("\\s+"))
            .filter { it.isNotBlank() }
            .map { methodTokenAliases[it] ?: it }
            .map { methodActionAliases[it] ?: it }
            .filter { it !in methodStopWords }

    private fun editDistanceAtMostOne(a: String, b: String): Boolean {
        if (a == b) return true
        if (kotlin.math.abs(a.length - b.length) > 1) return false
        var i = 0
        var j = 0
        var edits = 0
        while (i < a.length && j < b.length) {
            if (a[i] == b[j]) {
                i++
                j++
                continue
            }
            edits++
            if (edits > 1) return false
            when {
                a.length > b.length -> i++
                b.length > a.length -> j++
                else -> {
                    i++
                    j++
                }
            }
        }
        if (i < a.length || j < b.length) edits++
        return edits <= 1
    }

    private fun ensureMethodSentence(value: String): String {
        var text = value.trim()
            .trim(',', ';', ':', ' ', '-')
            .trimEnd('.', '?', '!')
            .trim()
        if (text.isBlank()) return ""
        text = text.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
        return "$text."
    }

    private fun splitCompositeMethodStep(value: String): Pair<String, String>? {
        val match = Regex("^(.+?)[,;]?\\s+and\\s+(.+)$", RegexOption.IGNORE_CASE).matchEntire(value.trim()) ?: return null
        val first = ensureMethodSentence(match.groupValues[1])
        val second = ensureMethodSentence(match.groupValues[2])
        if (first.isBlank() || second.isBlank()) return null
        val firstAction = methodWords(first).firstOrNull()
        val secondAction = methodWords(second).firstOrNull()
        if (firstAction !in methodActionWords || secondAction !in methodActionWords) return null
        return first to second
    }

    private fun compositeNeighborMatch(
        liveSteps: List<String>,
        parts: Pair<String, String>?,
        usedLive: Set<Int>
    ): Pair<Int, Int>? {
        if (parts == null) return null
        var bestFirst = -1
        var bestSecond = -1
        var bestAverage = 0.0
        for (liveIndex in 0 until liveSteps.lastIndex) {
            if (liveIndex in usedLive || liveIndex + 1 in usedLive) continue
            val firstScore = methodSimilarity(liveSteps[liveIndex], parts.first)
            val secondScore = methodSimilarity(liveSteps[liveIndex + 1], parts.second)
            val average = (firstScore + secondScore) / 2.0
            if (firstScore >= 0.56 && secondScore >= 0.56 && average >= 0.68 && average > bestAverage) {
                bestFirst = liveIndex
                bestSecond = liveIndex + 1
                bestAverage = average
            }
        }
        return if (bestFirst >= 0) bestFirst to bestSecond else null
    }

    private fun methodCandidates(
        liveSteps: List<String>,
        secondSteps: List<String>,
        handledSecond: Set<Int>,
        usedLive: Set<Int>
    ): List<MethodCandidate> {
        val candidates = mutableListOf<MethodCandidate>()
        secondSteps.forEachIndexed { secondIndex, secondRaw ->
            if (secondIndex in handledSecond) return@forEachIndexed
            val second = secondRaw.trim()
            if (second.isBlank()) return@forEachIndexed
            val parts = splitCompositeMethodStep(second)
            val neighbor = compositeNeighborMatch(liveSteps, parts, usedLive)
            if (parts != null && neighbor != null) {
                candidates += MethodCandidate(secondIndex, "$secondIndex:0", parts.first, neighbor.first)
                candidates += MethodCandidate(secondIndex, "$secondIndex:1", parts.second, neighbor.second)
            } else {
                candidates += MethodCandidate(secondIndex, "$secondIndex:0", second)
            }
        }
        return candidates
    }

    private fun display(item: Ingredient): String =
        listOf(item.quantity, item.unit, item.name).filter { it.isNotBlank() }.joinToString(" ").trim()

    private fun sameMeasure(a: Ingredient, b: Ingredient): Boolean =
        quantityKey(a.quantity) == quantityKey(b.quantity) && canonicalUnit(a.unit) == canonicalUnit(b.unit)

    private fun quantityKey(value: String): String = normalizeQuantityPhrase(value)

    // Comparison-only quantity normalization. Never changes saved recipe quantities.
    private fun normalizeQuantityPhrase(value: String): String {
        var output = value.trim().lowercase().replace(Regex("\\s+"), " ")
        output = output
            .replace("one half", "0.5")
            .replace("half", "0.5")
            .replace("quarter", "0.25")
            .replace("a quarter", "0.25")
            .replace("couple", "2")
            .replace("a couple", "2")
        return output.trim()
    }

    private fun canonicalUnit(raw: String): String {
        if (raw.isBlank()) return ""
        return IngredientParser.parse("1 $raw placeholder").unit.ifBlank { raw.trim().lowercase() }
    }

    private fun nameKey(item: Ingredient): String =
        coreWords(item.name, item.unit).joinToString(" ")

    private fun jaccard(a: Ingredient, b: Ingredient): Double {
        val left = coreWords(a.name, a.unit).toSet()
        val right = coreWords(b.name, b.unit).toSet()
        if (left.isEmpty() || right.isEmpty()) return 0.0
        val same = left.count { it in right }
        return same.toDouble() / max(1, left.size + right.size - same)
    }

    private fun coreWords(value: String, unit: String): List<String> =
        words(normalizeIngredientComparisonText(cleanupKnownAsrTail(value, unit)))
            .map { ingredientAliases[it] ?: it }
            .filter { it !in prepWords }

    private fun words(value: String): List<String> =
        value.lowercase()
            .replace(Regex("\\([^)]*\\)"), " ")
            .split(Regex("[^a-z0-9]+"))
            .filter { it.isNotBlank() }

    private fun normalizeIngredientComparisonText(value: String): String {
        var output = value

        // Comparison-only removal of conversational tails. This does not change saved recipe text.
        output = output.replace(
            Regex("(?i)\\s+(?:in\\s+there|right\\s+there|there|too|also|as\\s+well|let'?s|lets)\\s*$"),
            ""
        )

        // Common speech filler between words. Only used for matching.
        output = output.replace(
            Regex("(?i)\\b(?:uh|um|okay|ok|you\\s+know)\\b"),
            " "
        )

        return output.trim().replace(Regex("\\s+"), " ")
    }

    private fun cleanupKnownAsrTail(value: String, unit: String): String {
        var output = value.trim().replace(Regex("\\s+"), " ")
        output = output.replace(
            Regex("(?i)\\s+(?:(?:i|you|we)(?:'m|'re| am| are)?\\s+)?(?:gonna|going\\s+to)\\s*$"),
            ""
        ).trim()
        output = output.replace(Regex("(?i)\\s+(?:like|wait|actually|sorry|no)\\s*$"), "").trim()
        if (canonicalUnit(unit) == "cup") {
            output = output.replace(Regex("(?i)^full\\s+of\\s+"), "").trim()
        }
        return output
    }

    private fun containsCleanName(live: Ingredient, second: Ingredient): Boolean {
        val liveWords = coreWords(live.name, live.unit)
        val secondWords = coreWords(second.name, second.unit)
        if (secondWords.isEmpty() || liveWords.size <= secondWords.size) return false
        return secondWords.all { it in liveWords }
    }

    private fun isLikelyParserArtifact(
        live: Ingredient,
        secondIngredients: List<Ingredient>
    ): Boolean {
        val name = live.name.trim()
        val lower = name.lowercase()
        if (name.isBlank()) return true
        if (lower.matches(Regex("^(?:to|of|the|it|this|that|some|what|today|we|you|i|and|then|so|um|uh|let'?s|lets|there|too|also|okay|ok)$"))) return true
        if (lower.matches(Regex("^(?:minutes?|seconds?|hours?|degrees?)\\b.*"))) return true
        if (lower.matches(Regex("^\\d+(?:\\.\\d+)?\\s+(?:minutes?|seconds?|hours?|degrees?)\\b.*"))) return true
        if (lower.matches(Regex("^(?:today|so|what|you|we|i)\\b.*\\b(?:gonna|going|need|make|do)\\b.*"))) return true
        if (lower.matches(Regex(".*\\b(?:you|we|i)\\s*$")) && live.unit.isBlank()) return true
        if (IngredientParser.containsMeasurementEvidence(name)) return true
        if (lower.matches(Regex(".*\\b(?:oh\\s+(?:shit|s\\*+)|oops|uh|um|sorry)\\b.*"))) return true

        // If the second pass has the same measured clean ingredient entirely inside
        // this longer live name, this row is almost certainly a duplicate ASR artifact.
        if (secondIngredients.any { second ->
                sameMeasure(live, second) && containsCleanName(live, second)
            }) return true

        return false
    }

    private fun ingredientReviewConfidence(
        live: Ingredient,
        secondIngredients: List<Ingredient>
    ): Double {
        val name = live.name.trim().lowercase()
        if (name.isBlank()) return 0.0

        var score = 0.5
        val tokens = words(name)

        if (tokens.any { it.length >= 3 }) score += 0.15
        if (tokens.any { it !in actionOnlyWords }) score += 0.15
        if (IngredientParser.containsMeasurementEvidence(name)) score += 0.05

        val obviousSpeech = setOf(
            "lets", "let's", "there", "too", "also",
            "okay", "ok", "so", "um", "uh"
        )
        if (tokens.all { it in obviousSpeech }) score -= 0.75

        if (secondIngredients.any { second ->
                sameMeasure(live, second) && containsCleanName(live, second)
            }) {
            score -= 0.25
        }

        return score.coerceIn(0.0, 1.0)
    }

    private fun isActionOnly(item: Ingredient): Boolean {
        val itemWords = words(item.name)
        return itemWords.isNotEmpty() && itemWords.all { it in actionOnlyWords }
    }
}
