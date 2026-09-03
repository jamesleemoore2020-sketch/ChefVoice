package com.chefvoice.app.media

import android.content.Context
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import java.io.File
import java.util.UUID

class AudioRecorder(private val context: Context) {
    private var recorder: MediaRecorder? = null
    private var currentPath: String? = null

    /**
     * Returns the recording path, or null if the microphone could not be opened
     * (busy, revoked permission, or a device that rejects the encoder).
     *
     * prepare() and start() used to be called with nothing catching them, so a
     * microphone already held by another app crashed the app instead of showing a
     * message.
     */
    fun start(): String? {
        val dir = File(context.filesDir, "voice").apply { mkdirs() }
        val path = File(dir, "${UUID.randomUUID()}.m4a").absolutePath

        @Suppress("DEPRECATION")
        val mediaRecorder = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else MediaRecorder()
        return try {
            mediaRecorder.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioEncodingBitRate(128_000)
                setAudioSamplingRate(44_100)
                setOutputFile(path)
                prepare()
                start()
            }
            recorder = mediaRecorder
            currentPath = path
            path
        } catch (_: Throwable) {
            runCatching { mediaRecorder.release() }
            File(path).delete()
            recorder = null
            currentPath = null
            null
        }
    }

    fun stop(): String? {
        val path = currentPath
        return try {
            recorder?.stop()
            path
        } catch (_: RuntimeException) {
            path?.let { File(it).delete() }
            null
        } finally {
            recorder?.release()
            recorder = null
            currentPath = null
        }
    }

    fun cancel() {
        runCatching { recorder?.stop() }
        recorder?.release()
        currentPath?.let { File(it).delete() }
        recorder = null
        currentPath = null
    }
}

class AudioPlayer {
    private var player: MediaPlayer? = null

    fun play(path: String) {
        if (path.isBlank()) return
        stop()
        player = MediaPlayer().apply {
            setDataSource(path)
            setOnPreparedListener { it.start() }
            setOnCompletionListener { this@AudioPlayer.stop() }
            setOnErrorListener { _, _, _ ->
                this@AudioPlayer.stop()
                true
            }
            prepareAsync()
        }
    }

    fun stop() {
        player?.let {
            runCatching { if (it.isPlaying) it.stop() }
            it.release()
        }
        player = null
    }
}
