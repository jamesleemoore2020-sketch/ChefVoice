package com.chefvoice.app.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.FallbackStrategy
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.chefvoice.app.model.MediaAttachment
import com.chefvoice.app.model.MediaType
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit

internal enum class ChefCameraMode { PHOTO, VIDEO }

@Composable
internal fun ChefCameraScreen(
    initialMode: ChefCameraMode,
    videoEnabled: Boolean,
    onCaptured: (MediaAttachment) -> Unit,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val mainExecutor = remember(context) { ContextCompat.getMainExecutor(context) }
    val previewView = remember {
        PreviewView(context).apply {
            scaleType = PreviewView.ScaleType.FILL_CENTER
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        }
    }

    var mode by remember(initialMode) {
        mutableStateOf(if (!videoEnabled && initialMode == ChefCameraMode.VIDEO) ChefCameraMode.PHOTO else initialMode)
    }
    var lensFacing by remember { mutableStateOf(CameraSelector.LENS_FACING_BACK) }
    var cameraProvider by remember { mutableStateOf<ProcessCameraProvider?>(null) }
    var camera by remember { mutableStateOf<Camera?>(null) }
    var activeRecording by remember { mutableStateOf<Recording?>(null) }
    var torchOn by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf("Point the camera at your food.") }
    var cameraPermissionVersion by remember { mutableStateOf(0) }
    var audioPermissionVersion by remember { mutableStateOf(0) }

    val imageCapture = remember {
        ImageCapture.Builder()
            .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
            .build()
    }
    val recorder = remember {
        Recorder.Builder()
            .setQualitySelector(
                QualitySelector.fromOrderedList(
                    listOf(Quality.FHD, Quality.HD, Quality.SD),
                    FallbackStrategy.lowerQualityOrHigherThan(Quality.SD)
                )
            )
            .build()
    }
    val videoCapture = remember { VideoCapture.withOutput(recorder) }

    val cameraPermissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        cameraPermissionVersion++
        if (!it) status = "Camera permission is required to take photos or video inside ChefVoice."
    }
    val audioPermissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        audioPermissionVersion++
        if (!it) status = "Microphone permission was denied. Video can still be recorded without sound."
    }

    val hasCameraPermission = remember(cameraPermissionVersion) {
        ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    }
    val hasAudioPermission = remember(audioPermissionVersion) {
        ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    }

    LaunchedEffect(Unit) {
        if (!hasCameraPermission) cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
    }
    LaunchedEffect(mode, videoEnabled) {
        if (mode == ChefCameraMode.VIDEO && videoEnabled && !hasAudioPermission) {
            audioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    DisposableEffect(hasCameraPermission, lensFacing, lifecycleOwner) {
        if (!hasCameraPermission) {
            onDispose { }
        } else {
            val future = ProcessCameraProvider.getInstance(context)
            val listener = Runnable {
                runCatching {
                    val provider = future.get()
                    cameraProvider = provider
                    provider.unbindAll()
                    val preview = Preview.Builder().build().also {
                        it.setSurfaceProvider(previewView.surfaceProvider)
                    }
                    val selector = CameraSelector.Builder().requireLensFacing(lensFacing).build()
                    camera = provider.bindToLifecycle(
                        lifecycleOwner,
                        selector,
                        preview,
                        imageCapture,
                        videoCapture
                    )
                    torchOn = false
                    status = if (mode == ChefCameraMode.VIDEO) "Ready to record a cooking clip." else "Ready for a food photo."
                }.onFailure {
                    status = "Could not open this camera: ${it.message ?: "unknown camera error"}"
                }
            }
            future.addListener(listener, mainExecutor)
            onDispose {
                if (future.isDone) runCatching { future.get().unbindAll() }
                camera = null
            }
        }
    }

    fun mediaDir(): File = File(context.filesDir, "media").apply { mkdirs() }

    fun takePhoto() {
        if (!hasCameraPermission) {
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
            return
        }
        val target = File(mediaDir(), "${UUID.randomUUID()}.jpg")
        status = "Taking photo…"
        val options = ImageCapture.OutputFileOptions.Builder(target).build()
        imageCapture.takePicture(options, mainExecutor, object : ImageCapture.OnImageSavedCallback {
            override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
                onCaptured(MediaAttachment(path = target.absolutePath, type = MediaType.IMAGE))
                status = "✓ Photo attached. Take another or tap Done."
            }

            override fun onError(exception: ImageCaptureException) {
                target.delete()
                status = "Photo failed: ${exception.message ?: "camera error"}"
            }
        })
    }

    fun startVideo() {
        if (!videoEnabled) {
            status = "Finish continuous voice capture before recording video with sound. Photos are still available."
            return
        }
        if (!hasCameraPermission) {
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
            return
        }
        val target = File(mediaDir(), "${UUID.randomUUID()}.mp4")
        val output = FileOutputOptions.Builder(target).build()
        var pending = videoCapture.output.prepareRecording(context, output)
        if (hasAudioPermission) pending = pending.withAudioEnabled()
        status = if (hasAudioPermission) "Recording video + sound…" else "Recording silent video…"
        activeRecording = pending.start(mainExecutor) { event ->
            when (event) {
                is VideoRecordEvent.Status -> {
                    val seconds = TimeUnit.NANOSECONDS.toSeconds(event.recordingStats.recordedDurationNanos)
                    status = "● Recording ${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"
                }
                is VideoRecordEvent.Finalize -> {
                    activeRecording = null
                    if (!event.hasError()) {
                        onCaptured(MediaAttachment(path = target.absolutePath, type = MediaType.VIDEO))
                        status = "✓ Video attached. Record another or tap Done."
                    } else {
                        target.delete()
                        status = "Video failed (${event.error}). Try again."
                    }
                }
            }
        }
    }

    BackHandler {
        if (activeRecording != null) {
            activeRecording?.stop()
        } else {
            camera?.cameraControl?.enableTorch(false)
            onBack()
        }
    }

    Surface(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                TextButton(onClick = {
                    if (activeRecording != null) activeRecording?.stop() else onBack()
                }) { Text(if (activeRecording != null) "Stop" else "Done") }
                Text(
                    if (mode == ChefCameraMode.VIDEO) "ChefVoice Video" else "ChefVoice Camera",
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.weight(1f)
                )
                TextButton(
                    enabled = activeRecording == null,
                    onClick = {
                        lensFacing = if (lensFacing == CameraSelector.LENS_FACING_BACK) {
                            CameraSelector.LENS_FACING_FRONT
                        } else {
                            CameraSelector.LENS_FACING_BACK
                        }
                    }
                ) { Text("Flip") }
            }

            Box(Modifier.weight(1f).fillMaxWidth()) {
                if (hasCameraPermission) {
                    AndroidView(
                        factory = { previewView },
                        modifier = Modifier.fillMaxSize()
                    )
                } else {
                    Card(Modifier.align(Alignment.Center).padding(24.dp)) {
                        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text("ChefVoice needs camera access to capture food photos and cooking video.")
                            Button(onClick = { cameraPermissionLauncher.launch(Manifest.permission.CAMERA) }) {
                                Text("Allow camera")
                            }
                        }
                    }
                }
            }

            Column(
                modifier = Modifier.fillMaxWidth().padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text(status, style = MaterialTheme.typography.bodySmall)

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = { mode = ChefCameraMode.PHOTO },
                        enabled = activeRecording == null,
                        modifier = Modifier.weight(1f)
                    ) { Text(if (mode == ChefCameraMode.PHOTO) "● Photo" else "Photo") }
                    OutlinedButton(
                        onClick = { mode = ChefCameraMode.VIDEO },
                        enabled = activeRecording == null && videoEnabled,
                        modifier = Modifier.weight(1f)
                    ) { Text(if (mode == ChefCameraMode.VIDEO) "● Video" else "Video") }
                    OutlinedButton(
                        onClick = {
                            torchOn = !torchOn
                            camera?.cameraControl?.enableTorch(torchOn)
                        },
                        enabled = activeRecording == null && camera?.cameraInfo?.hasFlashUnit() == true,
                        modifier = Modifier.weight(1f)
                    ) { Text(if (torchOn) "Light on" else "Light") }
                }

                Button(
                    onClick = {
                        if (mode == ChefCameraMode.PHOTO) {
                            takePhoto()
                        } else if (activeRecording == null) {
                            startVideo()
                        } else {
                            activeRecording?.stop()
                        }
                    },
                    enabled = hasCameraPermission,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        when {
                            mode == ChefCameraMode.PHOTO -> "📷 Take photo"
                            activeRecording != null -> "⏹ Stop & attach video"
                            else -> "🔴 Record video"
                        }
                    )
                }

                if (!videoEnabled) {
                    Text(
                        "Video is temporarily unavailable while continuous voice capture is listening. This prevents the camera and recipe transcription from competing for the microphone.",
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }
        }
    }
}
