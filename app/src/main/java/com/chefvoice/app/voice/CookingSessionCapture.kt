package com.chefvoice.app.voice

import android.content.Context
import android.content.Intent
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import com.chefvoice.app.model.TranscriptSegment
import java.io.File
import java.io.RandomAccessFile
import java.util.Locale
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import kotlin.concurrent.thread
import kotlin.math.max

/**
 * Captures a cooking narration without making the chef stop after each sentence.
 *
 * Android 13+ (API 33+) uses one AudioRecord stream for both purposes:
 * 1. the PCM stream is saved as a WAV file (the chef's original voice), and
 * 2. the same stream is piped into SpeechRecognizer using EXTRA_AUDIO_SOURCE.
 *
 * Older Android versions fall back to rolling SpeechRecognizer sessions. They
 * still build a continuous transcript, but Android does not expose a reliable
 * way for us to save that same recognition microphone stream as one audio file.
 */
class CookingSessionCapture(
    context: Context,
    private val onSegment: (TranscriptSegment) -> Unit,
    private val onPartial: (String) -> Unit,
    private val onStatus: (String) -> Unit
) {
    private val appContext = context.applicationContext
    private val mainHandler = Handler(Looper.getMainLooper())

    private var speechRecognizer: SpeechRecognizer? = null
    private var audioRecord: AudioRecord? = null
    private var audioThread: Thread? = null
    private var pipeThread: Thread? = null
    private var pipeRead: ParcelFileDescriptor? = null
    private var pipeWrite: ParcelFileDescriptor? = null
    private var wavFile: File? = null
    private var wavDataBytes: Long = 0L
    private var startedAt = 0L
    private var running = false
    private var stopping = false
    private var injectedAudioMode = false
    private var stopRequestedAt = 0L
    private var lastRecognitionEventAt = 0L
    private var stopCallback: ((String?) -> Unit)? = null
    private val pipeQueue = LinkedBlockingQueue<ByteArray>(24)
    private var lastFinalText = ""
    private var lastPartialText = ""

    val isRunning: Boolean get() = running
    val savesFullSessionVoice: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU

    fun start(): Boolean {
        if (running) return true
        if (!SpeechRecognizer.isRecognitionAvailable(appContext)) {
            onStatus("Speech recognition is not available on this phone.")
            return false
        }

        startedAt = System.currentTimeMillis()
        lastFinalText = ""
        lastPartialText = ""
        running = true
        stopping = false
        stopCallback = null
        lastRecognitionEventAt = System.currentTimeMillis()
        onPartial("")

        return try {
            speechRecognizer = createRecognizer().also { it.setRecognitionListener(listener) }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                startInjectedAudioSession()
            } else {
                injectedAudioMode = false
                onStatus("Listening continuously. Original session audio requires Android 13+; manual chef voice clips still work.")
                startRollingRecognition()
            }
            true
        } catch (t: Throwable) {
            running = false
            cleanupAudio(deleteEmpty = true)
            destroyRecognizer()
            onStatus("Could not start cooking capture: ${t.message ?: "unknown error"}")
            false
        }
    }

    /**
     * Stops capture. Completion is reported only after recognition has gone quiet,
     * instead of after a fixed UI delay. Some recognition services deliver final
     * or segmented results well after the microphone stream closes.
     */
    fun stop(onComplete: (String?) -> Unit = {}): String? {
        if (!running && !stopping) {
            val path = validWavPath()
            mainHandler.post { onComplete(path) }
            return path
        }
        if (stopping) {
            stopCallback = onComplete
            return validWavPath()
        }

        running = false
        stopping = true
        stopRequestedAt = System.currentTimeMillis()
        stopCallback = onComplete

        // Preserve what is visibly on screen now. A later final result may improve
        // it; the recipe parser de-duplicates overlapping evidence.
        commitPendingPartial()
        onPartial("")

        if (injectedAudioMode) {
            runCatching { audioRecord?.stop() }
            runCatching { pipeWrite?.close() }
            pipeWrite = null
            audioThread?.join(1200)
            pipeThread?.join(300)
            runCatching { speechRecognizer?.stopListening() }
        } else {
            runCatching { speechRecognizer?.stopListening() }
        }

        onStatus("Processing every last spoken ingredient…")
        scheduleFinishCheck(700L)
        return validWavPath()
    }

    fun close() {
        running = false
        stopping = false
        stopCallback = null
        runCatching { audioRecord?.stop() }
        runCatching { pipeWrite?.close() }
        runCatching { pipeRead?.close() }
        pipeWrite = null
        pipeRead = null
        audioThread?.join(400)
        cleanupAudio(deleteEmpty = true)
        destroyRecognizer()
    }

    private fun createRecognizer(): SpeechRecognizer {
        return if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            SpeechRecognizer.isOnDeviceRecognitionAvailable(appContext)
        ) {
            // On-device recognition keeps kitchen narration local when the phone supports it.
            runCatching { SpeechRecognizer.createOnDeviceSpeechRecognizer(appContext) }
                .getOrElse { SpeechRecognizer.createSpeechRecognizer(appContext) }
        } else {
            SpeechRecognizer.createSpeechRecognizer(appContext)
        }
    }

    @androidx.annotation.RequiresApi(Build.VERSION_CODES.TIRAMISU)
    private fun startInjectedAudioSession() {
        injectedAudioMode = true
        val sampleRate = SAMPLE_RATE
        val channelMask = AudioFormat.CHANNEL_IN_MONO
        val encoding = AudioFormat.ENCODING_PCM_16BIT
        val minBuffer = AudioRecord.getMinBufferSize(sampleRate, channelMask, encoding)
        val bufferSize = max(if (minBuffer > 0) minBuffer * 2 else 4096, 4096)

        val record = AudioRecord.Builder()
            .setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(encoding)
                    .setSampleRate(sampleRate)
                    .setChannelMask(channelMask)
                    .build()
            )
            .setBufferSizeInBytes(bufferSize)
            .build()

        check(record.state == AudioRecord.STATE_INITIALIZED) { "Microphone audio could not be initialized" }
        audioRecord = record

        val voiceDir = File(appContext.filesDir, "voice").apply { mkdirs() }
        wavFile = File(voiceDir, "cooking-session-${UUID.randomUUID()}.wav")
        wavDataBytes = 0L

        val pipe = ParcelFileDescriptor.createPipe()
        pipeRead = pipe[0]
        pipeWrite = pipe[1]

        val intent = baseRecognitionIntent().apply {
            putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, pipeRead)
            putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1)
            putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
            putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, SAMPLE_RATE)
            putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_AUDIO_SOURCE)
        }

        speechRecognizer?.startListening(intent)
        startPipeWriter()
        startAudioWriter(record, bufferSize)
        onStatus("Listening continuously · saving the chef's full original voice")
    }

    private fun startAudioWriter(record: AudioRecord, bufferSize: Int) {
        val file = checkNotNull(wavFile)
        audioThread = thread(name = "ChefVoiceAudioCapture", start = true) {
            val raf = RandomAccessFile(file, "rw")
            try {
                raf.setLength(0)
                raf.write(ByteArray(WAV_HEADER_SIZE))
                record.startRecording()
                val buffer = ByteArray(bufferSize)

                while (running) {
                    val read = record.read(buffer, 0, buffer.size)
                    if (read > 0) {
                        raf.write(buffer, 0, read)
                        wavDataBytes += read
                        // Recognition receives a copy; a bounded queue prevents a slow
                        // recognizer from ever blocking or losing the original recording.
                        pipeQueue.offer(buffer.copyOf(read))
                    } else if (read == AudioRecord.ERROR_INVALID_OPERATION || read == AudioRecord.ERROR_BAD_VALUE) {
                        break
                    }
                }
            } catch (t: Throwable) {
                mainHandler.post { onStatus("Audio capture warning: ${t.message ?: "recording interrupted"}") }
            } finally {
                runCatching { record.stop() }
                record.release()
                audioRecord = null
                writeWavHeader(raf, wavDataBytes)
                raf.close()
                // Let the pipe writer drain the last captured chunks, then close.
                mainHandler.postDelayed({
                    runCatching { pipeWrite?.close() }
                    pipeWrite = null
                }, 120)
            }
        }
    }

    private fun startPipeWriter() {
        val writeFd = checkNotNull(pipeWrite)
        pipeThread = thread(name = "ChefVoiceRecognitionPipe", start = true) {
            val output = ParcelFileDescriptor.AutoCloseOutputStream(writeFd)
            try {
                while (running || pipeQueue.isNotEmpty()) {
                    val chunk = pipeQueue.poll()
                    if (chunk != null) {
                        output.write(chunk)
                        output.flush()
                    } else {
                        Thread.sleep(15)
                    }
                }
            } catch (_: Throwable) {
                // Some recognizers may reject injected audio. The WAV recording remains valid.
            } finally {
                runCatching { output.close() }
            }
        }
    }

    private fun startRollingRecognition(delayMs: Long = 0L) {
        if (!running) return
        mainHandler.postDelayed({
            if (!running) return@postDelayed
            runCatching { speechRecognizer?.startListening(baseRecognitionIntent()) }
                .onFailure {
                    onStatus("Speech recognizer paused; retrying…")
                    startRollingRecognition(700)
                }
        }, delayMs)
    }

    private fun baseRecognitionIntent(): Intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            putStringArrayListExtra(
                RecognizerIntent.EXTRA_BIASING_STRINGS,
                arrayListOf(
                    "ingredient", "ingredients", "add", "adding", "tablespoon", "tablespoons",
                    "teaspoon", "teaspoons", "tbsp", "tsp", "cup", "cups", "gram", "grams",
                    "ounce", "ounces", "pound", "pounds", "clove", "cloves", "pinch", "salt",
                    "pepper", "olive oil", "butter", "flour", "sugar", "garlic", "onion",
                    "degrees", "oven", "simmer", "saute", "bake", "roast", "whisk", "chop"
                )
            )
        }
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {
            if (running && !injectedAudioMode) onStatus("Listening continuously…")
        }

        override fun onBeginningOfSpeech() = Unit
        override fun onRmsChanged(rmsdB: Float) = Unit
        override fun onBufferReceived(buffer: ByteArray?) = Unit
        override fun onEndOfSpeech() = Unit

        override fun onError(error: Int) {
            markRecognitionEvent()
            if (!running) {
                if (stopping) scheduleFinishCheck(180L)
                return
            }
            if (injectedAudioMode) {
                // Keep the original voice recording even if this recognizer does not
                // support injected/segmented audio on a particular device.
                onStatus("Voice is still recording. Live transcription is unavailable on this recognizer.")
                return
            }

            val delay = when (error) {
                SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> 900L
                SpeechRecognizer.ERROR_NO_MATCH,
                SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> 250L
                else -> 600L
            }
            startRollingRecognition(delay)
        }

        override fun onResults(results: Bundle?) {
            markRecognitionEvent()
            commitBundle(results)
            if (running && !injectedAudioMode) startRollingRecognition(180)
        }

        override fun onPartialResults(partialResults: Bundle?) {
            markRecognitionEvent()
            val text = IngredientParser.normalizeSpeechText(bestResult(partialResults)).trim()
            if (text.isNotBlank()) {
                // If the recognizer had a measured ingredient in a partial result and
                // then suddenly rewrote that partial without the measurement, preserve
                // the earlier phrase as evidence instead of silently losing it.
                val previous = lastPartialText
                if (
                    previous.isNotBlank() &&
                    IngredientParser.containsMeasurementEvidence(previous) &&
                    !IngredientParser.containsMeasurementEvidence(text)
                ) {
                    commitText(previous)
                }
                lastPartialText = text
                onPartial(text)
            }
        }

        override fun onEvent(eventType: Int, params: Bundle?) = Unit

        override fun onSegmentResults(segmentResults: Bundle) {
            markRecognitionEvent()
            commitBundle(segmentResults)
        }

        override fun onEndOfSegmentedSession() {
            markRecognitionEvent()
            if (stopping) {
                commitPendingPartial()
                finishStopNow()
            } else if (running) {
                onStatus("Recognition session ended; the original voice recording is still being saved.")
            }
        }
    }

    private fun commitBundle(bundle: Bundle?) {
        val text = IngredientParser.normalizeSpeechText(bestResult(bundle)).trim()
        if (text.isBlank()) return
        commitText(text)
        lastPartialText = ""
        onPartial("")
    }

    private fun commitText(raw: String) {
        val text = IngredientParser.normalizeSpeechText(raw).trim()
        if (text.isBlank()) return
        val normalized = text.lowercase().replace(Regex("\\s+"), " ")
        if (normalized == lastFinalText) return
        lastFinalText = normalized
        onSegment(
            TranscriptSegment(
                elapsedMs = (System.currentTimeMillis() - startedAt).coerceAtLeast(0L),
                text = text.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
            )
        )
    }

    private fun commitPendingPartial() {
        val text = IngredientParser.normalizeSpeechText(lastPartialText).trim()
        if (text.isBlank()) return
        val normalized = text.lowercase().replace(Regex("\\s+"), " ")
        if (normalized == lastFinalText) {
            lastPartialText = ""
            return
        }
        lastPartialText = ""
        commitText(text)
    }

    /**
     * Normally the first hypothesis is the recognizer's best result. For cooking,
     * a close alternate that contains an explicit measurement is often more useful
     * than a fluent hypothesis that dropped "two teaspoons". Prefer that alternate
     * only when the first hypothesis has no measurement evidence.
     */
    private fun bestResult(bundle: Bundle?): String {
        val results = bundle
            ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            .orEmpty()
            .filter { it.isNotBlank() }
        if (results.isEmpty()) return ""
        // Prefer the hypothesis that retained the most explicit cooking measurements.
        // Ties keep Android's original ranking because maxByOrNull returns the first
        // maximum encountered.
        return results.maxByOrNull { IngredientParser.measurementEvidenceCount(it) } ?: results.first()
    }

    private fun markRecognitionEvent() {
        lastRecognitionEventAt = System.currentTimeMillis()
        if (stopping) scheduleFinishCheck(FINISH_QUIET_MS)
    }

    private fun scheduleFinishCheck(delayMs: Long) {
        mainHandler.removeCallbacks(finishCheckRunnable)
        mainHandler.postDelayed(finishCheckRunnable, delayMs)
    }

    private val finishCheckRunnable = Runnable {
        if (!stopping) return@Runnable
        val now = System.currentTimeMillis()
        val quietFor = now - lastRecognitionEventAt
        val stoppingFor = now - stopRequestedAt
        if (quietFor >= FINISH_QUIET_MS || stoppingFor >= FINISH_MAX_WAIT_MS) {
            commitPendingPartial()
            finishStopNow()
        } else {
            scheduleFinishCheck((FINISH_QUIET_MS - quietFor).coerceAtLeast(120L))
        }
    }

    private fun finishStopNow() {
        if (!stopping) return
        stopping = false
        mainHandler.removeCallbacks(finishCheckRunnable)
        destroyRecognizer()
        val callback = stopCallback
        stopCallback = null
        val path = validWavPath()
        onStatus("Cooking session captured. Building your recipe draft…")
        callback?.invoke(path)
    }

    private fun validWavPath(): String? {
        val file = wavFile ?: return null
        return file.takeIf { it.exists() && it.length() > WAV_HEADER_SIZE }?.absolutePath
    }

    private fun cleanupAudio(deleteEmpty: Boolean) {
        runCatching { audioRecord?.release() }
        audioRecord = null
        runCatching { pipeWrite?.close() }
        runCatching { pipeRead?.close() }
        pipeWrite = null
        pipeRead = null
        pipeQueue.clear()
        lastPartialText = ""
        if (deleteEmpty && wavDataBytes <= 0L) wavFile?.delete()
    }

    private fun destroyRecognizer() {
        runCatching { speechRecognizer?.cancel() }
        runCatching { speechRecognizer?.destroy() }
        speechRecognizer = null
        runCatching { pipeRead?.close() }
        pipeRead = null
    }

    private fun writeWavHeader(raf: RandomAccessFile, dataSize: Long) {
        val byteRate = SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE / 8
        val blockAlign = (CHANNELS * BITS_PER_SAMPLE / 8).toShort()
        val totalSize = dataSize + 36
        raf.seek(0)
        raf.writeBytes("RIFF")
        writeLittleEndianInt(raf, totalSize.toInt())
        raf.writeBytes("WAVE")
        raf.writeBytes("fmt ")
        writeLittleEndianInt(raf, 16)
        writeLittleEndianShort(raf, 1) // PCM
        writeLittleEndianShort(raf, CHANNELS.toShort())
        writeLittleEndianInt(raf, SAMPLE_RATE)
        writeLittleEndianInt(raf, byteRate)
        writeLittleEndianShort(raf, blockAlign)
        writeLittleEndianShort(raf, BITS_PER_SAMPLE.toShort())
        raf.writeBytes("data")
        writeLittleEndianInt(raf, dataSize.toInt())
    }

    private fun writeLittleEndianInt(raf: RandomAccessFile, value: Int) {
        raf.write(value and 0xff)
        raf.write(value shr 8 and 0xff)
        raf.write(value shr 16 and 0xff)
        raf.write(value shr 24 and 0xff)
    }

    private fun writeLittleEndianShort(raf: RandomAccessFile, value: Short) {
        val intValue = value.toInt()
        raf.write(intValue and 0xff)
        raf.write(intValue shr 8 and 0xff)
    }

    companion object {
        private const val SAMPLE_RATE = 16_000
        private const val CHANNELS = 1
        private const val BITS_PER_SAMPLE = 16
        private const val WAV_HEADER_SIZE = 44
        private const val FINISH_QUIET_MS = 1100L
        private const val FINISH_MAX_WAIT_MS = 4200L
    }
}
