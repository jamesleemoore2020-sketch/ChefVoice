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
