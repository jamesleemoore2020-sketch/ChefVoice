package com.chefvoice.app

import android.app.Application
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.disk.DiskCache
import coil3.memory.MemoryCache
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade
import coil3.video.VideoFrameDecoder
import okio.Path.Companion.toOkioPath

/**
 * Single image pipeline for ChefVoice.
 *
 * Every image used to be fetched by hand with URL.openStream() and decoded with
 * BitmapFactory at full resolution and with no cache, so a 25 MB community photo
 * became roughly 48 MB of heap to fill a 56.dp avatar, and a scrolling feed
 * re-downloaded and re-decoded the same picture on every item recycle. Coil gives
 * us size-aware decoding, a memory cache, a disk cache and request cancellation.
 */
class ChefVoiceApplication : Application(), SingletonImageLoader.Factory {

    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context)
            .components {
                // Recipe media can be a local video; this renders its first frame
                // as a thumbnail without loading the whole file into memory.
                add(VideoFrameDecoder.Factory())
                add(OkHttpNetworkFetcherFactory())
            }
            .memoryCache {
                MemoryCache.Builder()
                    .maxSizePercent(context, 0.25)
                    .build()
            }
            .diskCache {
                DiskCache.Builder()
                    .directory(cacheDir.resolve("chefvoice_image_cache").toOkioPath())
                    .maxSizeBytes(96L * 1024 * 1024)
                    .build()
            }
            .crossfade(true)
            .build()
}
