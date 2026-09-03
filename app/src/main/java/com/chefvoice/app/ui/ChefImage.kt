package com.chefvoice.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import coil3.compose.SubcomposeAsyncImage
import coil3.request.ImageRequest
import com.chefvoice.app.model.MediaAttachment
import com.chefvoice.app.model.MediaType
import java.io.File

/**
 * The one image entry point in the app. Everything visual routes through here so
 * decoding, caching and cancellation are handled by the shared Coil ImageLoader
 * configured in ChefVoiceApplication.
 *
 * [fallback] renders on a surfaceVariant tile whenever there is nothing to show:
 * no source, a source that failed, or a remote video we deliberately do not fetch.
 */
@Composable
internal fun ChefAsyncImage(
    model: Any?,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Crop,
    fallback: @Composable () -> Unit
) {
    if (model == null) {
        ChefImagePlaceholder(modifier, fallback)
        return
    }

    SubcomposeAsyncImage(
        model = ImageRequest.Builder(LocalContext.current).data(model).build(),
        contentDescription = contentDescription,
        contentScale = contentScale,
        modifier = modifier,
        loading = { ChefImagePlaceholder(Modifier.fillMaxSize()) {} },
        error = { ChefImagePlaceholder(Modifier.fillMaxSize(), fallback) }
    )
}

@Composable
private fun ChefImagePlaceholder(modifier: Modifier, content: @Composable () -> Unit) {
    Box(
        modifier.background(MaterialTheme.colorScheme.surfaceVariant),
        contentAlignment = Alignment.Center
    ) {
        content()
    }
}

/**
 * Picks the best source for a recipe attachment: the local file while it is still
 * on disk, otherwise the cloud copy.
 *
 * Remote videos resolve to null on purpose. Pulling a 200 MB cloud video down just
 * to render one thumbnail frame is not a trade worth making on cellular; the
 * attachment shows its 🎬 tile and plays on tap.
 */
internal fun mediaModel(attachment: MediaAttachment): Any? {
    val localFile = attachment.path
        .takeIf { it.isNotBlank() }
        ?.let(::File)
        ?.takeIf { it.exists() }
    if (localFile != null) return localFile
    if (attachment.type == MediaType.VIDEO) return null
    return attachment.remoteUrl.takeIf { it.startsWith("https://") }
}
