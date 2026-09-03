package com.chefvoice.app.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.chefvoice.app.notifications.ChefVoiceForegroundService
import com.google.firebase.firestore.DocumentChange
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.SetOptions
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.Camera2Enumerator
import org.webrtc.CameraVideoCapturer
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.RtpTransceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoCapturer
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/**
 * v0.6 prototype live transport.
 *
 * Firestore is used only for WebRTC signaling. Camera/microphone media travels peer-to-peer over
 * WebRTC and is not written to Firestore or Storage.
 *
 * This is intentionally a small-room mesh implementation: the host creates one PeerConnection per
 * viewer. It is suitable for validating real phone-to-phone live video. A production broadcast
 * with many viewers should move the media layer to an SFU/managed live-video service.
 */

private const val LIVE_STREAM_ID = "chefvoice-live"
private const val VIDEO_TRACK_ID = "chefvoice-video"
private const val AUDIO_TRACK_ID = "chefvoice-audio"
private const val MAX_ICE_CANDIDATES_PER_SIDE = 64

private fun iceCandidateDocumentId(sequence: Int): String? =
    sequence.takeIf { it in 0 until MAX_ICE_CANDIDATES_PER_SIDE }?.let { "c" + it.toString().padStart(3, '0') }

private val liveIceServers = listOf(
    PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
    PeerConnection.IceServer.builder("stun:stun1.l.google.com:19302").createIceServer()
)

private object WebRtcBootstrap {
    private val initialized = AtomicBoolean(false)

    fun ensure(context: Context) {
        if (initialized.compareAndSet(false, true)) {
            PeerConnectionFactory.initialize(
                PeerConnectionFactory.InitializationOptions.builder(context.applicationContext)
                    .setEnableInternalTracer(false)
                    .createInitializationOptions()
            )
        }
    }
}

@Composable
internal fun WebRtcLiveHostPanel(sessionId: String, hostUid: String, onReady: () -> Unit) {
    val context = LocalContext.current
    var permissionVersion by remember { mutableIntStateOf(0) }
    var status by remember(sessionId) { mutableStateOf("Preparing live broadcast…") }
    var viewerCount by remember(sessionId) { mutableIntStateOf(0) }
    var muted by remember(sessionId) { mutableStateOf(false) }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissionVersion++ }

    val hasCamera = remember(permissionVersion) {
        ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    }
    val hasMic = remember(permissionVersion) {
        ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    }

    LaunchedEffect(sessionId) {
        val missing = buildList {
            if (!hasCamera) add(Manifest.permission.CAMERA)
            if (!hasMic) add(Manifest.permission.RECORD_AUDIO)
        }
        if (missing.isNotEmpty()) permissionLauncher.launch(missing.toTypedArray())
    }

    if (!hasCamera || !hasMic) {
        Text("Camera and microphone permissions are required to broadcast live video.")
        return
    }

    val controller = remember(sessionId, hostUid) {
        WebRtcHostController(
            context = context.applicationContext,
            sessionId = sessionId,
            hostUid = hostUid,
            onStatus = { status = it },
            onViewerCount = { viewerCount = it },
            onReady = onReady
        )
    }

    val renderer = remember(controller) {
        SurfaceViewRenderer(context).apply {
            init(controller.eglContext, null)
            setMirror(true)
            setEnableHardwareScaler(true)
        }
    }

    DisposableEffect(controller, renderer) {
        // Camera + microphone foreground service. ChefVoiceApp still ends a broadcast
        // on ON_STOP as a deliberate privacy choice, so this mainly guarantees the
        // system never revokes capture mid-broadcast. Dropping that ON_STOP handler
        // is now all it takes to support broadcasting from the background.
        ChefVoiceForegroundService.start(context, ChefVoiceForegroundService.MODE_LIVE)
        controller.start(renderer)
        onDispose {
            controller.stop()
            renderer.release()
            ChefVoiceForegroundService.stop(context)
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(
            modifier = Modifier.fillMaxWidth().height(300.dp),
            contentAlignment = Alignment.Center
        ) {
            AndroidView(factory = { renderer }, modifier = Modifier.fillMaxWidth().height(300.dp))
        }
        Text(status)
        Text(if (viewerCount == 1) "1 viewer connected" else "$viewerCount viewers connected")
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            OutlinedButton(onClick = { controller.switchCamera() }) { Text("Flip") }
            OutlinedButton(onClick = {
                muted = !muted
                controller.setMuted(muted)
            }) { Text(if (muted) "Unmute mic" else "Mute mic") }
        }
    }
}

@Composable
internal fun WebRtcLiveViewerPanel(sessionId: String, viewerUid: String) {
    val context = LocalContext.current
    var status by remember(sessionId) { mutableStateOf("Joining live video…") }

    val controller = remember(sessionId, viewerUid) {
        WebRtcViewerController(
            context = context.applicationContext,
            sessionId = sessionId,
            viewerUid = viewerUid,
            onStatus = { status = it }
        )
    }

    val renderer = remember(controller) {
        SurfaceViewRenderer(context).apply {
            init(controller.eglContext, null)
            setMirror(false)
            setEnableHardwareScaler(true)
        }
    }

    DisposableEffect(controller, renderer) {
        controller.start(renderer)
        onDispose {
            controller.stop()
            renderer.release()
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(
            modifier = Modifier.fillMaxWidth().height(300.dp),
            contentAlignment = Alignment.Center
        ) {
            AndroidView(factory = { renderer }, modifier = Modifier.fillMaxWidth().height(300.dp))
        }
        Text(status)
    }
}

private abstract class BaseWebRtcController(
    protected val context: Context,
    protected val sessionId: String,
    private val onStatus: (String) -> Unit
) {
    protected val db: FirebaseFirestore = FirebaseFirestore.getInstance()
    protected val mainHandler = Handler(Looper.getMainLooper())
    protected val eglBase: EglBase
    protected val factory: PeerConnectionFactory
    val eglContext: EglBase.Context
        get() = eglBase.eglBaseContext

    init {
        WebRtcBootstrap.ensure(context)
        eglBase = EglBase.create()
        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
            .createPeerConnectionFactory()
    }

    protected fun status(message: String) {
        Log.i("ChefVoiceLive", "session=$sessionId $message")
        mainHandler.post { onStatus(message) }
    }

    protected fun newPeerConnection(observer: PeerConnection.Observer): PeerConnection? {
        val config = PeerConnection.RTCConfiguration(liveIceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }
        return factory.createPeerConnection(config, observer)
    }

    protected fun candidateMap(candidate: IceCandidate): Map<String, Any> = mapOf(
        "sdpMid" to (candidate.sdpMid ?: ""),
        "sdpMLineIndex" to candidate.sdpMLineIndex,
        "candidate" to candidate.sdp,
        "createdAt" to System.currentTimeMillis()
    )

    protected fun candidateFrom(data: Map<String, Any>): IceCandidate? {
        val sdp = data["candidate"] as? String ?: return null
        val mid = (data["sdpMid"] as? String).orEmpty().ifBlank { null }
        val index = (data["sdpMLineIndex"] as? Number)?.toInt() ?: return null
        return IceCandidate(mid, index, sdp)
    }

    protected fun sdpObserver(
        onCreateSuccess: (SessionDescription) -> Unit = {},
        onSetSuccess: () -> Unit = {},
        onFailure: (String) -> Unit = { status(it) }
    ) = object : SdpObserver {
        override fun onCreateSuccess(description: SessionDescription) = onCreateSuccess(description)
        override fun onSetSuccess() = onSetSuccess()
        override fun onCreateFailure(error: String) = onFailure(error)
        override fun onSetFailure(error: String) = onFailure(error)
    }

    protected fun noOpObserver(onIceCandidate: (IceCandidate) -> Unit): PeerConnection.Observer =
        object : PeerConnection.Observer {
            override fun onSignalingChange(newState: PeerConnection.SignalingState) = Unit
            override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState) = Unit
            override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
            override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState) = Unit
            override fun onIceCandidate(candidate: IceCandidate) = onIceCandidate(candidate)
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) = Unit
            override fun onAddStream(stream: MediaStream) = Unit
            override fun onRemoveStream(stream: MediaStream) = Unit
            override fun onDataChannel(dataChannel: DataChannel) = Unit
            override fun onRenegotiationNeeded() = Unit
        }

    abstract fun stop()
}

private class WebRtcHostController(
    context: Context,
    sessionId: String,
    private val hostUid: String,
    onStatus: (String) -> Unit,
    private val onViewerCount: (Int) -> Unit,
    private val onReady: () -> Unit
) : BaseWebRtcController(context, sessionId, onStatus) {

    private val peers = ConcurrentHashMap<String, HostPeer>()
    private var peerListener: ListenerRegistration? = null
    private var surfaceTextureHelper: SurfaceTextureHelper? = null
    private var videoCapturer: VideoCapturer? = null
    private var videoSource: VideoSource? = null
    private var audioSource: AudioSource? = null
    private var videoTrack: VideoTrack? = null
    private var audioTrack: AudioTrack? = null
    private var localRenderer: SurfaceViewRenderer? = null
    private var started = false

    fun start(renderer: SurfaceViewRenderer) {
        if (started) return
        started = true
        localRenderer = renderer
        status("Opening camera + microphone…")

        runCatching {
            videoCapturer = createCameraCapturer()
                ?: error("No usable phone camera was found.")
            val helper = SurfaceTextureHelper.create("ChefVoiceCapture", eglBase.eglBaseContext)
                ?: error("Could not create the WebRTC camera capture thread.")
            surfaceTextureHelper = helper
            videoSource = factory.createVideoSource(false)
            videoCapturer!!.initialize(helper, context, videoSource!!.capturerObserver)
            videoCapturer!!.startCapture(1280, 720, 30)
            videoTrack = factory.createVideoTrack(VIDEO_TRACK_ID, videoSource!!).also { it.addSink(renderer) }

            audioSource = factory.createAudioSource(MediaConstraints())
            audioTrack = factory.createAudioTrack(AUDIO_TRACK_ID, audioSource!!)

            listenForViewers()
            mainHandler.post { onReady() }
            status("LIVE video ready · waiting for viewers")
        }.onFailure {
            status("Could not start WebRTC broadcast: ${it.message ?: "unknown error"}")
        }
    }

    private fun createCameraCapturer(): VideoCapturer? {
        val enumerator = Camera2Enumerator(context)
        val names = enumerator.deviceNames
        names.firstOrNull { enumerator.isFrontFacing(it) }?.let { name ->
            enumerator.createCapturer(name, null)?.let { return it }
        }
        names.firstOrNull()?.let { name ->
            enumerator.createCapturer(name, null)?.let { return it }
        }
        return null
    }

    private fun listenForViewers() {
        val peersRef = db.collection("liveSessions").document(sessionId).collection("peers")
        peerListener = peersRef.addSnapshotListener { snapshot, error ->
            if (error != null) {
                status("Live signaling error: ${error.message ?: "Firestore listener failed"}")
                return@addSnapshotListener
            }
            snapshot?.documentChanges.orEmpty().forEach { change ->
                val peerId = change.document.id
                val viewerUid = change.document.getString("viewerUid").orEmpty()
                when (change.type) {
                    DocumentChange.Type.ADDED,
                    DocumentChange.Type.MODIFIED -> {
                        if (viewerUid.isNotBlank() && !peers.containsKey(peerId)) {
                            createHostPeer(peerId, viewerUid)
                        }
                    }
                    DocumentChange.Type.REMOVED -> {
                        peers.remove(peerId)?.close()
                        publishViewerCount()
                    }
                }
            }
        }
    }

    private fun createHostPeer(peerId: String, viewerUid: String) {
        val vTrack = videoTrack ?: return
        val aTrack = audioTrack ?: return
        val peerRef = db.collection("liveSessions").document(sessionId).collection("peers").document(peerId)
        val hostPeer = HostPeer(peerId, viewerUid, peerRef, vTrack, aTrack)
        peers[peerId] = hostPeer
        hostPeer.start()
    }

    private fun publishViewerCount() {
        val connected = peers.values.count { it.connected }
        mainHandler.post { onViewerCount(connected) }
        status(if (connected == 0) "LIVE video ready · waiting for viewers" else "Broadcasting live")
    }

    fun switchCamera() {
        val capturer = videoCapturer as? CameraVideoCapturer
        if (capturer == null) {
            status("Camera switching is unavailable on this device.")
            return
        }
        capturer.switchCamera(object : CameraVideoCapturer.CameraSwitchHandler {
            override fun onCameraSwitchDone(isFrontCamera: Boolean) {
                mainHandler.post { localRenderer?.setMirror(isFrontCamera) }
                status(if (isFrontCamera) "Front camera live" else "Back camera live")
            }
            override fun onCameraSwitchError(errorDescription: String) {
                status("Could not switch camera: $errorDescription")
            }
        })
    }

    fun setMuted(muted: Boolean) {
        audioTrack?.setEnabled(!muted)
        status(if (muted) "Microphone muted" else "Microphone live")
    }

    override fun stop() {
        peerListener?.remove()
        peerListener = null
        peers.values.forEach { it.close() }
        peers.clear()
        mainHandler.post { onViewerCount(0) }

        videoTrack?.let { track -> localRenderer?.let { track.removeSink(it) } }
        runCatching { videoCapturer?.stopCapture() }
        runCatching { videoCapturer?.dispose() }
        runCatching { surfaceTextureHelper?.dispose() }
        runCatching { videoTrack?.dispose() }
        runCatching { audioTrack?.dispose() }
        runCatching { videoSource?.dispose() }
        runCatching { audioSource?.dispose() }
        runCatching { factory.dispose() }
        runCatching { eglBase.release() }
        started = false
    }

    private inner class HostPeer(
        private val peerId: String,
        private val viewerUid: String,
        private val peerRef: DocumentReference,
        private val vTrack: VideoTrack,
        private val aTrack: AudioTrack
    ) {
        var connected: Boolean = false
            private set
        private var pc: PeerConnection? = null
        private var peerDocListener: ListenerRegistration? = null
        private var viewerCandidateListener: ListenerRegistration? = null
        private val pendingCandidates = mutableListOf<IceCandidate>()
        private val seenCandidateDocs = mutableSetOf<String>()
        private var remoteDescriptionSet = false
        private var answerApplied = false
        private var hostCandidateSequence = 0

        fun start() {
            val observerBase = noOpObserver { candidate ->
                val candidateId = iceCandidateDocumentId(hostCandidateSequence++)
                if (candidateId == null) {
                    status("Host ICE candidate limit reached for a viewer.")
                } else {
                    peerRef.collection("hostCandidates").document(candidateId).set(candidateMap(candidate))
                }
            }
            val observer = object : PeerConnection.Observer by observerBase {
                override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) {
                    val nowConnected = newState == PeerConnection.PeerConnectionState.CONNECTED
                    if (connected != nowConnected) {
                        connected = nowConnected
                        publishViewerCount()
                    }
                    if (newState == PeerConnection.PeerConnectionState.FAILED) {
                        status("A viewer could not connect. A TURN server may be required on this network.")
                    }
                }
            }
            pc = newPeerConnection(observer)
            val connection = pc ?: run {
                status("Could not create a WebRTC connection for a viewer.")
                return
            }
            connection.addTrack(vTrack, listOf(LIVE_STREAM_ID))
            connection.addTrack(aTrack, listOf(LIVE_STREAM_ID))

            peerDocListener = peerRef.addSnapshotListener { snapshot, error ->
                if (error != null) {
                    status("Viewer signaling error: ${error.message ?: "unknown error"}")
                    return@addSnapshotListener
                }
                val answer = snapshot?.getString("answerSdp").orEmpty()
                if (answer.isNotBlank() && !answerApplied) {
                    answerApplied = true
                    connection.setRemoteDescription(
                        sdpObserver(
                            onSetSuccess = {
                                remoteDescriptionSet = true
                                flushCandidates(connection)
                            },
                            onFailure = { status("Could not accept viewer answer: $it") }
                        ),
                        SessionDescription(SessionDescription.Type.ANSWER, answer)
                    )
                }
            }

            viewerCandidateListener = peerRef.collection("viewerCandidates")
                .addSnapshotListener { snapshot, error ->
                    if (error != null) return@addSnapshotListener
                    snapshot?.documentChanges.orEmpty().forEach { change ->
                        if (change.type != DocumentChange.Type.REMOVED && seenCandidateDocs.add(change.document.id)) {
                            candidateFrom(change.document.data)?.let { candidate ->
                                if (remoteDescriptionSet) connection.addIceCandidate(candidate)
                                else pendingCandidates += candidate
                            }
                        }
                    }
                }

            connection.createOffer(
                sdpObserver(
                    onCreateSuccess = { offer ->
                        connection.setLocalDescription(
                            sdpObserver(
                                onSetSuccess = {
                                    peerRef.set(
                                        mapOf(
                                            "viewerUid" to viewerUid,
                                            "hostUid" to hostUid,
                                            "offerSdp" to offer.description,
                                            "state" to "OFFERED",
                                            "updatedAt" to System.currentTimeMillis()
                                        ),
                                        SetOptions.merge()
                                    )
                                },
                                onFailure = { status("Could not set host offer: $it") }
                            ),
                            offer
                        )
                    },
                    onFailure = { status("Could not create live offer: $it") }
                ),
                MediaConstraints()
            )
        }

        private fun flushCandidates(connection: PeerConnection) {
            pendingCandidates.forEach { connection.addIceCandidate(it) }
            pendingCandidates.clear()
        }

        fun close() {
            peerDocListener?.remove()
            viewerCandidateListener?.remove()
            peerDocListener = null
            viewerCandidateListener = null
            runCatching { pc?.close() }
            runCatching { pc?.dispose() }
            pc = null
            connected = false
        }
    }
}

private class WebRtcViewerController(
    context: Context,
    sessionId: String,
    private val viewerUid: String,
    onStatus: (String) -> Unit
) : BaseWebRtcController(context, sessionId, onStatus) {

    private val peerId = viewerUid
    private val peerRef = db.collection("liveSessions").document(sessionId).collection("peers").document(peerId)
    private var pc: PeerConnection? = null
    private var peerDocListener: ListenerRegistration? = null
    private var hostCandidateListener: ListenerRegistration? = null
    private var remoteVideoTrack: VideoTrack? = null
    private var renderer: SurfaceViewRenderer? = null
    private val pendingCandidates = mutableListOf<IceCandidate>()
    private val seenCandidateDocs = mutableSetOf<String>()
    private var remoteDescriptionSet = false
    private var offerApplied = false
    private var started = false
    private var viewerCandidateSequence = 0

    fun start(renderer: SurfaceViewRenderer) {
        if (started) return
        started = true
        this.renderer = renderer
        status("Joining live video…")

        val observerBase = noOpObserver { candidate ->
            val candidateId = iceCandidateDocumentId(viewerCandidateSequence++)
            if (candidateId == null) {
                status("Live ICE candidate limit reached for this connection.")
            } else {
                peerRef.collection("viewerCandidates").document(candidateId).set(candidateMap(candidate))
            }
        }
        val observer = object : PeerConnection.Observer by observerBase {
            override fun onAddTrack(receiver: RtpReceiver, mediaStreams: Array<out MediaStream>) {
                attachRemoteTrack(receiver.track())
            }

            override fun onTrack(transceiver: RtpTransceiver) {
                attachRemoteTrack(transceiver.receiver.track())
            }

            override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) {
                when (newState) {
                    PeerConnection.PeerConnectionState.CONNECTED -> status("Watching LIVE video")
                    PeerConnection.PeerConnectionState.CONNECTING -> status("Connecting live video…")
                    PeerConnection.PeerConnectionState.DISCONNECTED -> status("Live video connection interrupted…")
                    PeerConnection.PeerConnectionState.FAILED -> status("Live video failed to connect. This network may require a TURN relay.")
                    PeerConnection.PeerConnectionState.CLOSED -> status("Live video closed")
                    else -> Unit
                }
            }
        }
        pc = newPeerConnection(observer)
        val connection = pc ?: run {
            status("Could not create WebRTC viewer connection.")
            return
        }

        peerDocListener = peerRef.addSnapshotListener { snapshot, error ->
            if (error != null) {
                status("Live signaling error: ${error.message ?: "unknown error"}")
                return@addSnapshotListener
            }
            val offer = snapshot?.getString("offerSdp").orEmpty()
            if (offer.isNotBlank() && !offerApplied) {
                offerApplied = true
                connection.setRemoteDescription(
                    sdpObserver(
                        onSetSuccess = {
                            remoteDescriptionSet = true
                            flushCandidates(connection)
                            createAnswer(connection)
                        },
                        onFailure = { status("Could not accept host stream: $it") }
                    ),
                    SessionDescription(SessionDescription.Type.OFFER, offer)
                )
            }
        }

        hostCandidateListener = peerRef.collection("hostCandidates")
            .addSnapshotListener { snapshot, error ->
                if (error != null) return@addSnapshotListener
                snapshot?.documentChanges.orEmpty().forEach { change ->
                    if (change.type != DocumentChange.Type.REMOVED && seenCandidateDocs.add(change.document.id)) {
                        candidateFrom(change.document.data)?.let { candidate ->
                            if (remoteDescriptionSet) connection.addIceCandidate(candidate)
                            else pendingCandidates += candidate
                        }
                    }
                }
            }

        peerRef.set(
            mapOf(
                "viewerUid" to viewerUid,
                "state" to "JOINING",
                "joinedAt" to System.currentTimeMillis(),
                "updatedAt" to System.currentTimeMillis()
            )
        ).addOnFailureListener {
            status("Could not join live signaling: ${it.message ?: "Firestore write failed"}")
        }
    }

    private fun createAnswer(connection: PeerConnection) {
        connection.createAnswer(
            sdpObserver(
                onCreateSuccess = { answer ->
                    connection.setLocalDescription(
                        sdpObserver(
                            onSetSuccess = {
                                peerRef.set(
                                    mapOf(
                                        "viewerUid" to viewerUid,
                                        "answerSdp" to answer.description,
                                        "state" to "ANSWERED",
                                        "updatedAt" to System.currentTimeMillis()
                                    ),
                                    SetOptions.merge()
                                )
                            },
                            onFailure = { status("Could not set viewer answer: $it") }
                        ),
                        answer
                    )
                },
                onFailure = { status("Could not answer live stream: $it") }
            ),
            MediaConstraints()
        )
    }

    private fun attachRemoteTrack(track: org.webrtc.MediaStreamTrack?) {
        if (track is VideoTrack) {
            mainHandler.post {
                if (remoteVideoTrack !== track) {
                    remoteVideoTrack?.let { old -> renderer?.let { old.removeSink(it) } }
                    remoteVideoTrack = track
                    renderer?.let { track.addSink(it) }
                }
            }
        }
        if (track is AudioTrack) {
            track.setEnabled(true)
        }
    }

    private fun flushCandidates(connection: PeerConnection) {
        pendingCandidates.forEach { connection.addIceCandidate(it) }
        pendingCandidates.clear()
    }

    override fun stop() {
        peerDocListener?.remove()
        hostCandidateListener?.remove()
        peerDocListener = null
        hostCandidateListener = null
        remoteVideoTrack?.let { track -> renderer?.let { track.removeSink(it) } }
        remoteVideoTrack = null
        runCatching { pc?.close() }
        runCatching { pc?.dispose() }
        pc = null
        cleanupSignaling()
        runCatching { factory.dispose() }
        runCatching { eglBase.release() }
        started = false
    }

    private fun cleanupSignaling() {
        peerRef.collection("hostCandidates").get().addOnSuccessListener { hostCandidates ->
            peerRef.collection("viewerCandidates").get().addOnSuccessListener { viewerCandidates ->
                val batch = db.batch()
                hostCandidates.documents.forEach { batch.delete(it.reference) }
                viewerCandidates.documents.forEach { batch.delete(it.reference) }
                batch.delete(peerRef)
                batch.commit()
            }.addOnFailureListener { peerRef.delete() }
        }.addOnFailureListener { peerRef.delete() }
    }
}
