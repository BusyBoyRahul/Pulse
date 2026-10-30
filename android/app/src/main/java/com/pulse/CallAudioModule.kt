package com.pulse

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.util.Base64
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Voice-call audio for Pulse, entirely on-device and number-free.
 *
 * Capture (mic) -> µ-law 8 kHz -> AES-256-GCM -> "CallFrame" event -> JS puts it
 * in a mesh packet addressed to the other person (relays carry it exactly like a
 * message, so a call works A -> B -> C when A and C are out of range).
 * Inbound frames come back through playFrame(): authenticate + decrypt, drop
 * replays/late frames, decode, play.
 *
 * The 256-bit key is derived in JS from the two people's key pair + call id, so
 * relays that carry the audio can't listen. Each direction has its own IV space
 * (byte 0) and a counter (bytes 8..11) so an IV is never reused.
 */
class CallAudioModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx) {

  override fun getName(): String = "CallAudio"

  @Volatile private var running = false
  @Volatile private var muted = false
  @Volatile private var key: SecretKeySpec? = null
  private var localDir = 0
  private var sendSeq = 0
  @Volatile private var lastRecvSeq = 0

  private var record: AudioRecord? = null
  private var track: AudioTrack? = null
  private var captureThread: Thread? = null
  private var playThread: Thread? = null
  private val playQueue = LinkedBlockingQueue<ShortArray>(MAX_QUEUE)

  private var savedMode = AudioManager.MODE_NORMAL
  private var savedSpeaker = false
  private var lastPeerLevelAt = 0L

  private val audioManager: AudioManager
    get() = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  private fun emit(event: String, data: Any?) {
    if (!ctx.hasActiveReactInstance()) return
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(event, data)
  }

  // ---- JS API -------------------------------------------------------------

  /** direction: 0 = caller, 1 = callee. keyB64 = 32 raw bytes. */
  @ReactMethod
  fun start(keyB64: String, direction: Int, promise: Promise) {
    if (running) {
      promise.resolve(true)
      return
    }
    if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) !=
        PackageManager.PERMISSION_GRANTED) {
      promise.reject("NO_MIC", "Microphone permission is needed to place or answer calls.")
      return
    }
    try {
      val raw = Base64.decode(keyB64, Base64.NO_WRAP)
      if (raw.size != 32) {
        promise.reject("BAD_KEY", "call key must be 32 bytes")
        return
      }
      // Keep the microphone alive if the user leaves the screen mid-call.
      MeshForegroundService.callMode(ctx, true)
      key = SecretKeySpec(raw, "AES")
      localDir = if (direction == 0) 0 else 1
      sendSeq = 0
      lastRecvSeq = 0
      playQueue.clear()

      val am = audioManager
      savedMode = am.mode
      savedSpeaker = am.isSpeakerphoneOn
      am.mode = AudioManager.MODE_IN_COMMUNICATION
      am.isSpeakerphoneOn = false

      val inMin =
          AudioRecord.getMinBufferSize(
              RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
      val rec =
          AudioRecord(
              MediaRecorder.AudioSource.VOICE_COMMUNICATION,
              RATE,
              AudioFormat.CHANNEL_IN_MONO,
              AudioFormat.ENCODING_PCM_16BIT,
              max(inMin, FRAME_SAMPLES * 2 * 4))
      if (rec.state != AudioRecord.STATE_INITIALIZED) {
        rec.release()
        am.mode = savedMode
        promise.reject("MIC_BUSY", "Couldn't open the microphone.")
        return
      }

      val outMin =
          AudioTrack.getMinBufferSize(
              RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
      val trk =
          AudioTrack.Builder()
              .setAudioAttributes(
                  AudioAttributes.Builder()
                      .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                      .build())
              .setAudioFormat(
                  AudioFormat.Builder()
                      .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                      .setSampleRate(RATE)
                      .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                      .build())
              .setBufferSizeInBytes(max(outMin, FRAME_SAMPLES * 2 * 4))
              .setTransferMode(AudioTrack.MODE_STREAM)
              .build()

      record = rec
      track = trk
      running = true
      rec.startRecording()
      trk.play()

      captureThread = Thread({ captureLoop(rec) }, "pulse-call-capture").also { it.start() }
      playThread = Thread({ playLoop(trk) }, "pulse-call-play").also { it.start() }
      promise.resolve(true)
    } catch (e: Exception) {
      teardown()
      promise.reject("CALL_START_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    teardown()
    promise.resolve(true)
  }

  @ReactMethod
  fun setMuted(on: Boolean) {
    muted = on
  }

  @ReactMethod
  fun setSpeaker(on: Boolean) {
    try {
      audioManager.isSpeakerphoneOn = on
    } catch (_: Exception) {}
  }

  /** An encrypted frame from the other side (arrived via the mesh). */
  @ReactMethod
  fun playFrame(frameB64: String) {
    if (!running) return
    val k = key ?: return
    try {
      val raw = Base64.decode(frameB64, Base64.NO_WRAP)
      if (raw.size <= 4 + TAG_BYTES) return
      val seq = ((raw[0].toInt() and 0xFF) shl 24) or ((raw[1].toInt() and 0xFF) shl 16) or
          ((raw[2].toInt() and 0xFF) shl 8) or (raw[3].toInt() and 0xFF)
      if (seq <= lastRecvSeq) return // replayed or arrived too late to be useful
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, k, GCMParameterSpec(128, iv(1 - localDir, seq)))
      val ulaw = cipher.doFinal(raw, 4, raw.size - 4) // throws if forged/corrupt
      lastRecvSeq = seq
      val pcm = ShortArray(ulaw.size)
      var sumSq = 0.0
      for (i in ulaw.indices) {
        val s = mulawToLinear(ulaw[i])
        pcm[i] = s
        sumSq += s.toDouble() * s
      }
      if (!playQueue.offer(pcm)) { // keep latency bounded: drop the oldest
        playQueue.poll()
        playQueue.offer(pcm)
      }
      val now = System.currentTimeMillis()
      if (now - lastPeerLevelAt > 150) {
        lastPeerLevelAt = now
        val m = Arguments.createMap()
        m.putString("side", "peer")
        m.putDouble("level", level(sqrt(sumSq / max(1, pcm.size))))
        emit("CallLevel", m)
      }
    } catch (_: Exception) {
      // Bad tag / garbage: ignore the frame, never crash the call.
    }
  }

  // ---- internals ----------------------------------------------------------

  private fun iv(dir: Int, seq: Int): ByteArray {
    val iv = ByteArray(12)
    iv[0] = dir.toByte()
    iv[8] = (seq ushr 24).toByte()
    iv[9] = (seq ushr 16).toByte()
    iv[10] = (seq ushr 8).toByte()
    iv[11] = seq.toByte()
    return iv
  }

  private fun level(rms: Double): Double = min(1.0, rms / 6000.0)

  private fun captureLoop(rec: AudioRecord) {
    val pcm = ShortArray(FRAME_SAMPLES)
    var hangover = 0
    var frames = 0
    while (running) {
      var got = 0
      while (got < FRAME_SAMPLES && running) {
        val n = rec.read(pcm, got, FRAME_SAMPLES - got)
        if (n <= 0) break
        got += n
      }
      if (got < FRAME_SAMPLES || muted) continue

      var sumSq = 0.0
      for (s in pcm) sumSq += s.toDouble() * s
      val rms = sqrt(sumSq / FRAME_SAMPLES)

      frames++
      if (frames % 3 == 0) {
        val m = Arguments.createMap()
        m.putString("side", "me")
        m.putDouble("level", level(rms))
        emit("CallLevel", m)
      }

      // Silence suppression: don't spend radio on dead air (halves the traffic).
      if (rms < SILENCE_RMS) {
        if (hangover == 0) continue
        hangover--
      } else {
        hangover = HANGOVER_FRAMES
      }

      val k = key ?: continue
      try {
        val ulaw = ByteArray(FRAME_SAMPLES) { i -> linearToMulaw(pcm[i]) }
        val seq = ++sendSeq
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, k, GCMParameterSpec(128, iv(localDir, seq)))
        val ct = cipher.doFinal(ulaw)
        val out = ByteArray(4 + ct.size)
        out[0] = (seq ushr 24).toByte()
        out[1] = (seq ushr 16).toByte()
        out[2] = (seq ushr 8).toByte()
        out[3] = seq.toByte()
        System.arraycopy(ct, 0, out, 4, ct.size)
        val m = Arguments.createMap()
        m.putString("frame", Base64.encodeToString(out, Base64.NO_WRAP))
        emit("CallFrame", m)
      } catch (_: Exception) {}
    }
  }

  private fun playLoop(trk: AudioTrack) {
    var primed = false
    while (running) {
      try {
        // Let two frames queue up first so a single late frame doesn't stutter.
        if (!primed) {
          if (playQueue.size < 2) {
            Thread.sleep(20)
            continue
          }
          primed = true
        }
        val pcm = playQueue.poll(120, TimeUnit.MILLISECONDS)
        if (pcm == null) {
          primed = false // went quiet; re-prime on the next burst
          continue
        }
        trk.write(pcm, 0, pcm.size)
      } catch (_: InterruptedException) {
        return
      } catch (_: Exception) {}
    }
  }

  private fun teardown() {
    MeshForegroundService.callMode(ctx, false)
    running = false
    key = null
    try { captureThread?.join(300) } catch (_: Exception) {}
    try { playThread?.interrupt() } catch (_: Exception) {}
    try { record?.stop() } catch (_: Exception) {}
    try { record?.release() } catch (_: Exception) {}
    try { track?.stop() } catch (_: Exception) {}
    try { track?.release() } catch (_: Exception) {}
    record = null
    track = null
    captureThread = null
    playThread = null
    playQueue.clear()
    muted = false
    try {
      val am = audioManager
      am.isSpeakerphoneOn = savedSpeaker
      am.mode = savedMode
    } catch (_: Exception) {}
  }

  override fun invalidate() {
    teardown()
    super.invalidate()
  }

  /**
   * Ring the phone when a call comes in while Pulse is in the background or the
   * screen is off. Heads-up notification with the caller's NAME only.
   */
  @ReactMethod
  fun showIncomingCall(name: String) {
    try {
      NotifyHelper.showIncomingCall(ctx, name)
    } catch (_: Exception) {}
  }

  @ReactMethod
  fun clearIncomingCall() {
    try {
      ctx.getSystemService(NotificationManager::class.java).cancel(CALL_NOTIF_ID)
    } catch (_: Exception) {}
  }

  @ReactMethod fun addListener(eventName: String) {}

  @ReactMethod fun removeListeners(count: Int) {}

  // ---- G.711 µ-law --------------------------------------------------------

  private fun linearToMulaw(sample: Short): Byte {
    var s = sample.toInt()
    val sign = if (s < 0) { s = -s; 0x80 } else 0
    if (s > CLIP) s = CLIP
    s += BIAS
    var exp = 7
    var mask = 0x4000
    while (exp > 0 && (s and mask) == 0) { exp--; mask = mask shr 1 }
    val mant = (s shr (exp + 3)) and 0x0F
    return (sign or (exp shl 4) or mant).inv().toByte()
  }

  private fun mulawToLinear(b: Byte): Short {
    val u = b.toInt().inv() and 0xFF
    val exp = (u shr 4) and 0x07
    val mant = u and 0x0F
    val t = (((mant shl 3) + BIAS) shl exp) - BIAS
    return (if ((u and 0x80) != 0) -t else t).toShort()
  }

  companion object {
    private const val CALL_CHANNEL = "pulse_calls"
    private const val CALL_NOTIF_ID = 4712
    private const val RATE = 8000
    private const val FRAME_SAMPLES = 480 // 60 ms
    private const val TAG_BYTES = 16
    private const val MAX_QUEUE = 8
    private const val SILENCE_RMS = 90.0
    private const val HANGOVER_FRAMES = 8
    private const val BIAS = 0x84
    private const val CLIP = 32635
  }
}
