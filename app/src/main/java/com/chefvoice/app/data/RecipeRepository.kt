package com.chefvoice.app.data

import android.content.Context
import com.chefvoice.app.model.Ingredient
import com.chefvoice.app.model.MediaAttachment
import com.chefvoice.app.model.MediaType
import com.chefvoice.app.model.Recipe
import com.chefvoice.app.model.RecipeCollection
import com.chefvoice.app.model.ShoppingItem
import com.chefvoice.app.model.SecondPassIssue
import com.chefvoice.app.model.SecondPassMethodIssue
import com.chefvoice.app.model.SecondPassResult
import com.chefvoice.app.model.TranscriptSegment
import com.chefvoice.app.model.VoiceClip
import com.chefvoice.app.model.stableStepIds
import org.json.JSONArray
import org.json.JSONObject

class RecipeRepository(context: Context) {
    private val prefs = context.getSharedPreferences("chefvoice", Context.MODE_PRIVATE)
    private val filesDir = context.filesDir

    /**
     * Deletes media and cooking audio that no saved recipe references any more.
     *
     * A cooking session writes a 16 kHz mono WAV at roughly 115 MB per hour, and
     * picked videos are copied into internal storage. Nothing ever removed the
     * files left behind by an abandoned session or a deleted recipe, so internal
     * storage only grew. Returns the number of bytes reclaimed.
     */
    fun pruneOrphanedMedia(): Long {
        val referenced = buildSet {
            loadRecipes().forEach { recipe ->
                recipe.media.forEach { if (it.path.isNotBlank()) add(it.path) }
                recipe.voiceClips.forEach { if (it.path.isNotBlank()) add(it.path) }
            }
        }

        var reclaimed = 0L
        listOf("media", "voice").forEach { folder ->
            val dir = java.io.File(filesDir, folder)
            if (!dir.isDirectory) return@forEach
            dir.listFiles()?.forEach { file ->
                if (!file.isFile || file.absolutePath in referenced) return@forEach
                // Leave anything written in the last hour alone: a session in
                // progress has not been attached to a recipe yet.
                if (System.currentTimeMillis() - file.lastModified() < 60 * 60 * 1000L) return@forEach
                val size = file.length()
                if (file.delete()) reclaimed += size
            }
        }
        return reclaimed
    }

    fun loadRecipes(): List<Recipe> {
        val raw = prefs.getString("recipes", null) ?: return emptyList()
        return runCatching {
            val array = JSONArray(raw)
            buildList {
                for (i in 0 until array.length()) add(array.getJSONObject(i).toRecipe())
            }
        }.getOrDefault(emptyList())
    }

    fun saveRecipes(recipes: List<Recipe>) {
        val array = JSONArray()
        recipes.forEach { array.put(it.toJson()) }
        prefs.edit().putString("recipes", array.toString()).apply()
    }

    fun loadDisplayName(): String = prefs.getString("display_name", "Chef") ?: "Chef"

    fun saveDisplayName(name: String) {
        prefs.edit().putString("display_name", name.ifBlank { "Chef" }).apply()
    }

    fun loadLikedIds(): Set<String> = prefs.getStringSet("liked_ids", emptySet()) ?: emptySet()

    fun saveLikedIds(ids: Set<String>) {
        prefs.edit().putStringSet("liked_ids", ids).apply()
    }

    /**
     * Collections and the shopping list are stored the same way the recipes are: JSON
     * in this device's preferences, never in Firestore. Neither is shared with anyone,
     * so neither needs a cloud collection or a security rule, and a chef signed out of
     * ChefVoice still has both.
     *
     * Both loaders swallow malformed JSON and return an empty list. A corrupt shopping
     * list must not be able to stop the app opening.
     */
    fun loadCollections(): List<RecipeCollection> {
        val raw = prefs.getString("collections", null) ?: return emptyList()
        return runCatching {
            val array = JSONArray(raw)
            buildList {
                for (i in 0 until array.length()) add(array.getJSONObject(i).toCollection())
            }
        }.getOrDefault(emptyList())
    }

    fun saveCollections(collections: List<RecipeCollection>) {
        val array = JSONArray()
        collections.forEach { array.put(it.toJson()) }
        prefs.edit().putString("collections", array.toString()).apply()
    }

    fun loadShoppingItems(): List<ShoppingItem> {
        val raw = prefs.getString("shopping_items", null) ?: return emptyList()
        return runCatching {
            val array = JSONArray(raw)
            buildList {
                for (i in 0 until array.length()) add(array.getJSONObject(i).toShoppingItem())
            }
        }.getOrDefault(emptyList())
    }

    fun saveShoppingItems(items: List<ShoppingItem>) {
        val array = JSONArray()
        items.forEach { array.put(it.toJson()) }
        prefs.edit().putString("shopping_items", array.toString()).apply()
    }
}

// internal rather than private so a JVM test can round-trip a recipe through the exact
// JSON the phone stores; nothing outside this module can see them either way.
internal fun Recipe.toJson() = JSONObject().apply {
    put("id", id)
    put("title", title)
    put("description", description)
    put("servings", servings)
    put("prepTimeMinutes", prepTimeMinutes)
    put("cookTimeMinutes", cookTimeMinutes)
    put("isPublic", isPublic)
    put("authorId", authorId)
    put("authorName", authorName)
    put("createdAt", createdAt)
    put("updatedAt", updatedAt)
    put("likes", likes)
    put("commentCount", commentCount)
    put("communityUpdatePending", communityUpdatePending)
    // Tags were never written here, so every tag a chef added lived only until the app
    // was next closed. The Community publish path reads them from this same in-memory
    // recipe, so a restart followed by "Update Community" would also have pushed an
    // empty tag list over the published one.
    put("tags", JSONArray().apply { tags.forEach { put(it) } })

    put("ingredients", JSONArray().apply {
        ingredients.forEach { ingredient ->
            put(JSONObject().apply {
                put("id", ingredient.id)
                put("quantity", ingredient.quantity)
                put("unit", ingredient.unit)
                put("name", ingredient.name)
            })
        }
    })

    put("steps", JSONArray().apply { steps.forEach { put(it) } })
    put("stepIds", JSONArray().apply { stableStepIds().forEach { put(it) } })

    put("media", JSONArray().apply {
        media.forEach { attachment ->
            put(JSONObject().apply {
                put("id", attachment.id)
                put("path", attachment.path)
                put("type", attachment.type.name)
                put("remoteUrl", attachment.remoteUrl)
                put("stepId", attachment.stepId)
                put("caption", attachment.caption)
            })
        }
    })

    put("voiceClips", JSONArray().apply {
        voiceClips.forEach { clip ->
            put(JSONObject().apply {
                put("id", clip.id)
                put("path", clip.path)
                put("label", clip.label)
                put("createdAt", clip.createdAt)
                put("remoteUrl", clip.remoteUrl)
            })
        }
    })

    put("transcript", JSONArray().apply {
        transcript.forEach { segment ->
            put(JSONObject().apply {
                put("id", segment.id)
                put("elapsedMs", segment.elapsedMs)
                put("text", segment.text)
            })
        }
    })

    secondPass?.let { result ->
        put("secondPass", result.toJson())
    }
}


private fun SecondPassResult.toJson() = JSONObject().apply {
    put("provider", provider)
    put("model", model)
    put("transcript", transcript)
    put("confirmedCount", confirmedCount)
    put("ranAt", ranAt)
    put("ingredients", JSONArray().apply {
        ingredients.forEach { item ->
            put(JSONObject().apply {
                put("id", item.id)
                put("quantity", item.quantity)
                put("unit", item.unit)
                put("name", item.name)
            })
        }
    })
    put("issues", JSONArray().apply {
        issues.forEach { issue ->
            put(JSONObject().apply {
                put("id", issue.id)
                put("type", issue.type)
                put("title", issue.title)
                put("detail", issue.detail)
                put("liveIndex", issue.liveIndex)
                put("secondIndex", issue.secondIndex)
                put("confidence", issue.confidence)
                issue.suggested?.let { suggested ->
                    put("suggested", JSONObject().apply {
                        put("id", suggested.id)
                        put("quantity", suggested.quantity)
                        put("unit", suggested.unit)
                        put("name", suggested.name)
                    })
                }
            })
        }
    })
    put("steps", JSONArray().apply { steps.forEach { put(it) } })
    put("methodConfirmedCount", methodConfirmedCount)
    put("methodIssues", JSONArray().apply {
        methodIssues.forEach { issue ->
            put(JSONObject().apply {
                put("id", issue.id)
                put("type", issue.type)
                put("title", issue.title)
                put("detail", issue.detail)
                put("liveIndex", issue.liveIndex)
                put("secondIndex", issue.secondIndex)
                put("confidence", issue.confidence)
                issue.suggestedStep?.let { put("suggestedStep", it) }
            })
        }
    })
}

private fun JSONObject.toSecondPassResult(): SecondPassResult {
    val ingredientArray = optJSONArray("ingredients") ?: JSONArray()
    val secondIngredients = buildList {
        for (i in 0 until ingredientArray.length()) {
            val item = ingredientArray.getJSONObject(i)
            add(Ingredient(
                id = item.optString("id"),
                quantity = item.optString("quantity"),
                unit = item.optString("unit"),
                name = item.optString("name")
            ))
        }
    }

    val issueArray = optJSONArray("issues") ?: JSONArray()
    val issues = buildList {
        for (i in 0 until issueArray.length()) {
            val item = issueArray.getJSONObject(i)
            val suggestion = item.optJSONObject("suggested")?.let { suggested ->
                Ingredient(
                    id = suggested.optString("id"),
                    quantity = suggested.optString("quantity"),
                    unit = suggested.optString("unit"),
                    name = suggested.optString("name")
                )
            }
            add(SecondPassIssue(
                id = item.optString("id"),
                type = item.optString("type"),
                title = item.optString("title"),
                detail = item.optString("detail"),
                liveIndex = item.optInt("liveIndex", -1),
                secondIndex = item.optInt("secondIndex", -1),
                suggested = suggestion,
                confidence = item.optDouble("confidence", 0.75)
            ))
        }
    }

    val stepArray = optJSONArray("steps") ?: JSONArray()
    val secondSteps = buildList {
        for (i in 0 until stepArray.length()) {
            stepArray.optString(i).trim().takeIf { it.isNotBlank() }?.let { add(it) }
        }
    }

    val methodIssueArray = optJSONArray("methodIssues") ?: JSONArray()
    val methodIssues = buildList {
        for (i in 0 until methodIssueArray.length()) {
            val item = methodIssueArray.getJSONObject(i)
            add(SecondPassMethodIssue(
                id = item.optString("id"),
                type = item.optString("type"),
                title = item.optString("title"),
                detail = item.optString("detail"),
                liveIndex = item.optInt("liveIndex", -1),
                secondIndex = item.optInt("secondIndex", -1),
                suggestedStep = item.optString("suggestedStep").takeIf { it.isNotBlank() },
                confidence = item.optDouble("confidence", 0.75)
            ))
        }
    }

    return SecondPassResult(
        provider = optString("provider", "google-cloud-speech-v2"),
        model = optString("model", "chirp_3"),
        transcript = optString("transcript"),
        ingredients = secondIngredients,
        issues = issues,
        confirmedCount = optInt("confirmedCount", 0),
        steps = secondSteps,
        methodIssues = methodIssues,
        methodConfirmedCount = optInt("methodConfirmedCount", 0),
        ranAt = optLong("ranAt", System.currentTimeMillis())
    )
}

internal fun JSONObject.toRecipe(): Recipe {
    fun optArray(name: String): JSONArray = optJSONArray(name) ?: JSONArray()

    // Recipes saved before tags were persisted have no "tags" key, which reads as none.
    val tagArray = optArray("tags")
    val tags = buildList {
        for (i in 0 until tagArray.length()) {
            val value = tagArray.optString(i)
            if (value.isNotBlank()) add(value)
        }
    }

    val ingredientArray = optArray("ingredients")
    val ingredients = buildList {
        for (i in 0 until ingredientArray.length()) {
            val item = ingredientArray.getJSONObject(i)
            add(Ingredient(
                id = item.optString("id"),
                quantity = item.optString("quantity"),
                unit = item.optString("unit"),
                name = item.optString("name")
            ))
        }
    }

    val stepArray = optArray("steps")
    val steps = buildList {
        for (i in 0 until stepArray.length()) add(stepArray.optString(i))
    }

    val stepIdArray = optArray("stepIds")
    val stepIds = buildList {
        for (i in 0 until stepIdArray.length()) add(stepIdArray.optString(i))
    }

    val mediaArray = optArray("media")
    val media = buildList {
        for (i in 0 until mediaArray.length()) {
            val item = mediaArray.getJSONObject(i)
            add(MediaAttachment(
                id = item.optString("id"),
                path = item.optString("path"),
                type = runCatching { MediaType.valueOf(item.optString("type")) }.getOrDefault(MediaType.IMAGE),
                remoteUrl = item.optString("remoteUrl"),
                stepId = item.optString("stepId"),
                caption = item.optString("caption")
            ))
        }
    }

    val clipArray = optArray("voiceClips")
    val clips = buildList {
        for (i in 0 until clipArray.length()) {
            val item = clipArray.getJSONObject(i)
            add(VoiceClip(
                id = item.optString("id"),
                path = item.optString("path"),
                label = item.optString("label", "Chef voice"),
                createdAt = item.optLong("createdAt", System.currentTimeMillis()),
                remoteUrl = item.optString("remoteUrl")
            ))
        }
    }

    val transcriptArray = optArray("transcript")
    val transcript = buildList {
        for (i in 0 until transcriptArray.length()) {
            val item = transcriptArray.getJSONObject(i)
            add(TranscriptSegment(
                id = item.optString("id"),
                elapsedMs = item.optLong("elapsedMs", 0L),
                text = item.optString("text")
            ))
        }
    }

    return Recipe(
        id = optString("id"),
        title = optString("title"),
        description = optString("description"),
        servings = optInt("servings", 2),
        prepTimeMinutes = optInt("prepTimeMinutes", 0).coerceAtLeast(0),
        cookTimeMinutes = optInt("cookTimeMinutes", 0).coerceAtLeast(0),
        ingredients = ingredients,
        steps = steps,
        stepIds = if (stepIds.size == steps.size) stepIds else steps.indices.map { index -> "${optString("id")}:step:${index + 1}" },
        media = media,
        voiceClips = clips,
        transcript = transcript,
        secondPass = optJSONObject("secondPass")?.toSecondPassResult(),
        isPublic = optBoolean("isPublic", false),
        authorId = optString("authorId"),
        authorName = optString("authorName", "Chef"),
        createdAt = optLong("createdAt", System.currentTimeMillis()),
        updatedAt = optLong("updatedAt", System.currentTimeMillis()),
        likes = optInt("likes", 0),
        commentCount = optInt("commentCount", 0),
        communityUpdatePending = optBoolean("communityUpdatePending", false),
        tags = tags
    )
}

private fun RecipeCollection.toJson() = JSONObject().apply {
    put("id", id)
    put("name", name)
    put("recipeIds", JSONArray().apply { recipeIds.forEach { put(it) } })
    put("createdAt", createdAt)
    put("updatedAt", updatedAt)
}

private fun JSONObject.toCollection(): RecipeCollection {
    val idArray = optJSONArray("recipeIds") ?: JSONArray()
    return RecipeCollection(
        id = optString("id"),
        name = optString("name"),
        recipeIds = buildList {
            for (i in 0 until idArray.length()) {
                val value = idArray.optString(i)
                if (value.isNotBlank()) add(value)
            }
        },
        createdAt = optLong("createdAt", System.currentTimeMillis()),
        updatedAt = optLong("updatedAt", System.currentTimeMillis())
    )
}

private fun ShoppingItem.toJson() = JSONObject().apply {
    put("id", id)
    put("name", name)
    put("quantity", quantity)
    put("unit", unit)
    put("recipeId", recipeId)
    put("recipeTitle", recipeTitle)
    put("checked", checked)
    put("addedAt", addedAt)
}

private fun JSONObject.toShoppingItem() = ShoppingItem(
    id = optString("id"),
    name = optString("name"),
    quantity = optString("quantity"),
    unit = optString("unit"),
    recipeId = optString("recipeId"),
    recipeTitle = optString("recipeTitle"),
    checked = optBoolean("checked", false),
    addedAt = optLong("addedAt", System.currentTimeMillis())
)
