package com.chefvoice.app.util

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import com.chefvoice.app.model.Recipe
import java.io.File

fun recipeShareText(recipe: Recipe): String = buildString {
    appendLine(recipe.title)
    if (recipe.description.isNotBlank()) appendLine(recipe.description)
    appendLine()
    appendLine("Ingredients")
    recipe.ingredients.forEach { appendLine("• ${it.displayText()}") }
    appendLine()
    appendLine("Method")
    recipe.steps.forEachIndexed { index, step -> appendLine("${index + 1}. $step") }
    appendLine()
    append("Shared from ChefVoice by ${recipe.authorName}")
    // Only a published recipe is reachable at this URL -- the PWA's ?recipe=
    // deep link opens straight into it; anything else would just 404 into the
    // bare feed, so a private/unpublished recipe shares as plain text only.
    if (recipe.isPublic) {
        appendLine()
        append("https://chefvoice-d7fec.web.app/?tab=community&recipe=${recipe.id}")
    }
}

fun shareRecipe(context: Context, recipe: Recipe) {
    val mediaUris = ArrayList(recipe.media.mapNotNull { attachment ->
        val file = File(attachment.path)
        if (!file.exists()) null else FileProvider.getUriForFile(
            context,
            "${context.packageName}.files",
            file
        )
    })

    val intent = if (mediaUris.size > 1) {
        Intent(Intent.ACTION_SEND_MULTIPLE).apply {
            type = "*/*"
            putParcelableArrayListExtra(Intent.EXTRA_STREAM, mediaUris)
        }
    } else {
        Intent(Intent.ACTION_SEND).apply {
            type = if (mediaUris.isEmpty()) "text/plain" else "*/*"
            mediaUris.firstOrNull()?.let { putExtra(Intent.EXTRA_STREAM, it) }
        }
    }.apply {
        putExtra(Intent.EXTRA_TEXT, recipeShareText(recipe))
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }

    context.startActivity(Intent.createChooser(intent, "Share recipe"))
}

/**
 * Shares plain text through the system chooser.
 *
 * Used for the shopping list, which has no media and no recipe behind it -- a chef
 * sending "what to buy" to a partner wants text they can read in any app, not a
 * ChefVoice-shaped payload.
 */
fun shareText(context: Context, title: String, body: String) {
    if (body.isBlank()) return
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_SUBJECT, title)
        putExtra(Intent.EXTRA_TEXT, body)
    }
    context.startActivity(Intent.createChooser(intent, title))
}
