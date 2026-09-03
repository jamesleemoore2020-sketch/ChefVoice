package com.chefvoice.app.media

import android.content.Context
import android.net.Uri
import com.chefvoice.app.model.MediaAttachment
import com.chefvoice.app.model.MediaType
import java.io.File
import java.util.UUID

fun copyPickedMedia(context: Context, uri: Uri): MediaAttachment? {
    val mime = context.contentResolver.getType(uri) ?: return null
    val type = if (mime.startsWith("video/")) MediaType.VIDEO else MediaType.IMAGE
    val ext = when (mime) {
        "image/jpeg" -> "jpg"
        "image/png" -> "png"
        "image/webp" -> "webp"
        "video/mp4" -> "mp4"
        "video/webm" -> "webm"
        else -> if (type == MediaType.VIDEO) "mp4" else "jpg"
    }

    val dir = File(context.filesDir, "media").apply { mkdirs() }
    val target = File(dir, "${UUID.randomUUID()}.$ext")

    return runCatching {
        context.contentResolver.openInputStream(uri)?.use { input ->
            target.outputStream().use { output -> input.copyTo(output) }
        } ?: return null
        MediaAttachment(path = target.absolutePath, type = type)
    }.getOrNull()
}

// loadMediaThumbnail lived here and decoded local photos and video frames at full
// resolution on the calling thread, with no downsampling and no cache. Thumbnails
// now go through Coil (see ui/ChefImage.kt and ChefVoiceApplication), which sizes
// the decode to the target and reuses the result.
