package com.pulse

import android.Manifest
import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.media.AudioAttributes
import android.media.MediaMetadataRetriever
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.Base64
import android.webkit.MimeTypeMap
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.RandomAccessFile

/**
 * Everything Pulse needs to handle real files without extra libraries:
 *  - pick any file / video from the phone (copied into Pulse's private folder)
 *  - read / write a file in pieces (so a 25 MB video never sits in memory)
 *  - save a received file or photo to the user's phone, open it in another app
 *  - voice notes: record + play
 *  - fingerprint / face prompt for the app lock
 *  - restart the app (after restoring a backup)
 * All files live in <app files>/pulse_files and nowhere else.
 */
class MediaFilesModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx), ActivityEventListener {

  init {
    ctx.addActivityEventListener(this)
  }

  override fun getName(): String = "MediaFiles"

  private val main = Handler(Looper.getMainLooper())
  private var pickPromise: Promise? = null
  private var savePromise: Promise? = null
  private var pendingSave: File? = null

  private fun dir(): File = File(ctx.filesDir, "pulse_files").apply { mkdirs() }

  /** Only ever touch files inside Pulse's own folder. */
  private fun safe(path: String): File? {
    val f = File(path)
    return try {
      if (f.canonicalPath.startsWith(dir().canonicalPath + File.separator)) f else null
    } catch (_: Exception) {
      null
    }
  }

  private fun emit(event: String, data: Any?) {
    if (!ctx.hasActiveReactInstance()) return
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(event, data)
  }

  // ---- folder / basic file ops ---------------------------------------------

  @ReactMethod
  fun filesDir(promise: Promise) = promise.resolve(dir().absolutePath)

  @ReactMethod
  fun allocate(path: String, size: Double, promise: Promise) {
    try {
      val f = safe(path) ?: return promise.reject("BAD_PATH", "outside Pulse folder")
      f.parentFile?.mkdirs()
      RandomAccessFile(f, "rw").use { it.setLength(size.toLong()) }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("ALLOC_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun readChunk(path: String, offset: Double, length: Int, promise: Promise) {
    try {
      val f = safe(path) ?: return promise.reject("BAD_PATH", "outside Pulse folder")
      RandomAccessFile(f, "r").use { raf ->
        raf.seek(offset.toLong())
        val buf = ByteArray(length)
        val n = raf.read(buf)
        promise.resolve(if (n <= 0) "" else Base64.encodeToString(buf, 0, n, Base64.NO_WRAP))
      }
    } catch (e: Exception) {
      promise.reject("READ_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun writeChunk(path: String, offset: Double, b64: String, promise: Promise) {
    try {
      val f = safe(path) ?: return promise.reject("BAD_PATH", "outside Pulse folder")
      f.parentFile?.mkdirs()
      RandomAccessFile(f, "rw").use { raf ->
        raf.seek(offset.toLong())
        raf.write(Base64.decode(b64, Base64.NO_WRAP))
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("WRITE_FAILED", e.message, e)
    }
  }

  /** A second copy of a stored file (forwarding must not share one file between two chats). */
  @ReactMethod
  fun copyFile(path: String, promise: Promise) {
    try {
      val src = safe(path)
      if (src == null || !src.exists()) return promise.reject("NO_FILE", "file is gone")
      val dest = File(dir(), "${System.currentTimeMillis()}_${src.name.substringAfter('_')}")
      src.copyTo(dest, overwrite = true)
      promise.resolve(dest.absolutePath)
    } catch (e: Exception) {
      promise.reject("COPY_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun fileInfo(path: String, promise: Promise) {
    val f = safe(path)
    val m = Arguments.createMap()
    m.putBoolean("exists", f?.exists() == true)
    m.putDouble("size", (f?.takeIf { it.exists() }?.length() ?: 0L).toDouble())
    promise.resolve(m)
  }

  @ReactMethod
  fun deleteFile(path: String, promise: Promise) {
    try {
      promise.resolve(safe(path)?.delete() ?: false)
    } catch (_: Exception) {
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun usage(promise: Promise) {
    var count = 0
    var bytes = 0L
    dir().listFiles()?.forEach {
      if (it.isFile) {
        count++
        bytes += it.length()
      }
    }
    val m = Arguments.createMap()
    m.putInt("count", count)
    m.putDouble("bytes", bytes.toDouble())
    promise.resolve(m)
  }

  @ReactMethod
  fun clearAll(promise: Promise) {
    try {
      dir().listFiles()?.forEach { it.delete() }
      promise.resolve(true)
    } catch (_: Exception) {
      promise.resolve(false)
    }
  }

  // ---- picking ----------------------------------------------------------------

  @ReactMethod
  fun pickFile(mime: String?, maxBytes: Double, promise: Promise) {
    val act = currentActivity ?: return promise.reject("NO_ACTIVITY", "no screen")
    pickPromise?.reject("CANCELLED", "replaced")
    pickPromise = promise
    maxPick = maxBytes.toLong()
    val i =
        Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(if (mime.isNullOrEmpty()) "*/*" else mime)
    try {
      act.startActivityForResult(i, REQ_PICK)
    } catch (e: Exception) {
      pickPromise = null
      promise.reject("NO_PICKER", e.message, e)
    }
  }

  private var maxPick = 25L * 1024 * 1024

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode == REQ_PICK) {
      val p = pickPromise ?: return
      pickPromise = null
      val uri = data?.data
      if (resultCode != Activity.RESULT_OK || uri == null) {
        p.reject("CANCELLED", "cancelled")
        return
      }
      Thread { copyPicked(uri, p) }.start()
    } else if (requestCode == REQ_SAVE) {
      val p = savePromise ?: return
      savePromise = null
      val src = pendingSave
      pendingSave = null
      val uri = data?.data
      if (resultCode != Activity.RESULT_OK || uri == null || src == null) {
        p.resolve(false)
        return
      }
      Thread {
            try {
              ctx.contentResolver.openOutputStream(uri)?.use { out -> src.inputStream().use { it.copyTo(out) } }
              p.resolve(true)
            } catch (e: Exception) {
              p.reject("SAVE_FAILED", e.message, e)
            }
          }
          .start()
    }
  }

  override fun onNewIntent(intent: Intent) {}

  private fun copyPicked(uri: Uri, p: Promise) {
    try {
      var name = "file"
      var size = -1L
      ctx.contentResolver.query(uri, null, null, null, null)?.use { c ->
        if (c.moveToFirst()) {
          val ni = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          val si = c.getColumnIndex(OpenableColumns.SIZE)
          if (ni >= 0) name = c.getString(ni) ?: name
          if (si >= 0 && !c.isNull(si)) size = c.getLong(si)
        }
      }
      if (size > maxPick) {
        p.reject("TOO_LARGE", size.toString())
        return
      }
      val clean = name.replace(Regex("[^A-Za-z0-9._ -]"), "_").take(80)
      val dest = File(dir(), "${System.currentTimeMillis()}_$clean")
      var total = 0L
      ctx.contentResolver.openInputStream(uri)?.use { input ->
        dest.outputStream().use { out ->
          val buf = ByteArray(64 * 1024)
          while (true) {
            val n = input.read(buf)
            if (n < 0) break
            total += n
            if (total > maxPick) {
              out.close()
              dest.delete()
              p.reject("TOO_LARGE", total.toString())
              return
            }
            out.write(buf, 0, n)
          }
        }
      } ?: run {
        p.reject("READ_FAILED", "couldn't open the file")
        return
      }
      var mime = ctx.contentResolver.getType(uri)
      if (mime.isNullOrEmpty() || mime == "application/octet-stream") {
        val ext = MimeTypeMap.getFileExtensionFromUrl(name.replace(" ", "_")).lowercase()
        mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
      }
      val m = Arguments.createMap()
      m.putString("path", dest.absolutePath)
      m.putString("name", name)
      m.putDouble("size", total.toDouble())
      m.putString("mime", mime)
      p.resolve(m)
    } catch (e: Exception) {
      p.reject("PICK_FAILED", e.message, e)
    }
  }

  // ---- saving + opening ----------------------------------------------------------

  /** "Save as…" through Android's own file dialog (works on every version, no permission). */
  @ReactMethod
  fun saveAs(path: String, name: String, mime: String?, promise: Promise) {
    val act = currentActivity ?: return promise.reject("NO_ACTIVITY", "no screen")
    val f = safe(path)
    if (f == null || !f.exists()) return promise.reject("NO_FILE", "file is gone")
    savePromise?.resolve(false)
    savePromise = promise
    pendingSave = f
    val i =
        Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(if (mime.isNullOrEmpty()) "application/octet-stream" else mime)
            .putExtra(Intent.EXTRA_TITLE, name)
    try {
      act.startActivityForResult(i, REQ_SAVE)
    } catch (e: Exception) {
      savePromise = null
      promise.reject("SAVE_FAILED", e.message, e)
    }
  }

  /** Straight into the gallery (Pictures/Pulse). Android 10+; older phones use saveAs. */
  @ReactMethod
  fun saveImageToGallery(b64: String, name: String, promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return promise.resolve(false)
    try {
      val bytes = Base64.decode(b64, Base64.NO_WRAP)
      val values =
          ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, name)
            put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
            put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Pulse")
            put(MediaStore.Images.Media.IS_PENDING, 1)
          }
      val resolver = ctx.contentResolver
      val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return promise.resolve(false)
      resolver.openOutputStream(uri)?.use { it.write(bytes) }
      values.clear()
      values.put(MediaStore.Images.Media.IS_PENDING, 0)
      resolver.update(uri, values, null, null)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("SAVE_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun openFile(path: String, mime: String?, promise: Promise) {
    try {
      val f = safe(path)
      if (f == null || !f.exists()) return promise.reject("NO_FILE", "file is gone")
      val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", f)
      val i =
          Intent(Intent.ACTION_VIEW)
              .setDataAndType(uri, if (mime.isNullOrEmpty()) "*/*" else mime)
              .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      ctx.startActivity(i)
      promise.resolve(true)
    } catch (e: android.content.ActivityNotFoundException) {
      promise.reject("NO_APP", "no app can open this file")
    } catch (e: Exception) {
      promise.reject("OPEN_FAILED", e.message, e)
    }
  }

  /** A small preview picture + length for a video (or just the length for audio). */
  @ReactMethod
  fun mediaInfo(path: String, promise: Promise) {
    val f = safe(path) ?: return promise.reject("BAD_PATH", "outside Pulse folder")
    Thread {
          val r = MediaMetadataRetriever()
          try {
            r.setDataSource(f.absolutePath)
            val dur = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
            val m = Arguments.createMap()
            m.putDouble("durationMs", dur.toDouble())
            var thumb: String? = null
            val frame = r.getFrameAtTime(if (dur > 2000) 1_000_000 else 0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
            if (frame != null) {
              val scale = 240f / maxOf(frame.width, frame.height)
              val small = if (scale < 1f) Bitmap.createScaledBitmap(frame, (frame.width * scale).toInt(), (frame.height * scale).toInt(), true) else frame
              var q = 60
              var bytes: ByteArray
              do {
                val out = ByteArrayOutputStream()
                small.compress(Bitmap.CompressFormat.JPEG, q, out)
                bytes = out.toByteArray()
                q -= 10
              } while (bytes.size > 7000 && q >= 20)
              if (bytes.size <= 9000) thumb = Base64.encodeToString(bytes, Base64.NO_WRAP)
            }
            if (thumb != null) m.putString("thumb", thumb)
            promise.resolve(m)
          } catch (e: Exception) {
            promise.resolve(Arguments.createMap())
          } finally {
            try {
              r.release()
            } catch (_: Exception) {}
          }
        }
        .start()
  }

  // ---- voice notes -----------------------------------------------------------------

  private var recorder: MediaRecorder? = null
  private var recFile: File? = null
  private var recStart = 0L

  @ReactMethod
  fun voiceStart(promise: Promise) {
    if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      return promise.reject("NO_MIC", "Microphone permission is needed.")
    }
    if (recorder != null) return promise.reject("BUSY", "already recording")
    try {
      stopPlayback()
      val f = File(dir(), "voice-${System.currentTimeMillis()}.m4a")
      val r = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(ctx) else @Suppress("DEPRECATION") MediaRecorder()
      r.setAudioSource(MediaRecorder.AudioSource.MIC)
      r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
      r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
      r.setAudioChannels(1)
      r.setAudioSamplingRate(16000)
      r.setAudioEncodingBitRate(24000)
      r.setOutputFile(f.absolutePath)
      r.prepare()
      r.start()
      recorder = r
      recFile = f
      recStart = System.currentTimeMillis()
      promise.resolve(true)
    } catch (e: Exception) {
      cleanupRecorder(true)
      promise.reject("REC_FAILED", e.message, e)
    }
  }

  private fun cleanupRecorder(deleteFile: Boolean) {
    try {
      recorder?.release()
    } catch (_: Exception) {}
    recorder = null
    if (deleteFile) recFile?.delete()
    if (deleteFile) recFile = null
  }

  @ReactMethod
  fun voiceStop(promise: Promise) {
    val r = recorder ?: return promise.reject("NOT_RECORDING", "not recording")
    val f = recFile
    val dur = System.currentTimeMillis() - recStart
    try {
      r.stop()
    } catch (e: RuntimeException) {
      cleanupRecorder(true)
      return promise.reject("TOO_SHORT", "too short")
    }
    cleanupRecorder(false)
    recFile = null
    if (f == null || !f.exists() || dur < 700) {
      f?.delete()
      return promise.reject("TOO_SHORT", "too short")
    }
    val m = Arguments.createMap()
    m.putString("path", f.absolutePath)
    m.putDouble("durationMs", dur.toDouble())
    m.putDouble("size", f.length().toDouble())
    promise.resolve(m)
  }

  @ReactMethod
  fun voiceCancel(promise: Promise) {
    try {
      recorder?.stop()
    } catch (_: Exception) {}
    cleanupRecorder(true)
    promise.resolve(true)
  }

  // ---- playback ----------------------------------------------------------------------

  private var player: MediaPlayer? = null
  private var playing: String? = null
  private val ticker =
      object : Runnable {
        override fun run() {
          val p = player ?: return
          try {
            if (p.isPlaying) {
              emitState("playing", p.currentPosition, p.duration)
              main.postDelayed(this, 200)
            }
          } catch (_: Exception) {}
        }
      }

  private fun emitState(state: String, pos: Int, dur: Int) {
    val m = Arguments.createMap()
    m.putString("path", playing ?: "")
    m.putString("state", state)
    m.putInt("pos", pos)
    m.putInt("dur", dur)
    emit("PlayerState", m)
  }

  private fun stopPlayback() {
    main.removeCallbacks(ticker)
    val was = playing
    try {
      player?.release()
    } catch (_: Exception) {}
    player = null
    if (was != null) {
      emitState("stopped", 0, 0)
    }
    playing = null
  }

  @ReactMethod
  fun playStart(path: String, promise: Promise) {
    val f = safe(path) ?: return promise.reject("BAD_PATH", "outside Pulse folder")
    main.post {
      try {
        stopPlayback()
        val p = MediaPlayer()
        p.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
        p.setDataSource(f.absolutePath)
        p.setOnCompletionListener {
          main.removeCallbacks(ticker)
          emitState("done", 0, it.duration)
          try {
            it.release()
          } catch (_: Exception) {}
          player = null
          playing = null
        }
        p.setOnErrorListener { _, _, _ ->
          emitState("error", 0, 0)
          player = null
          playing = null
          true
        }
        p.prepare()
        p.start()
        player = p
        playing = path
        emitState("playing", 0, p.duration)
        main.postDelayed(ticker, 200)
        promise.resolve(true)
      } catch (e: Exception) {
        stopPlayback()
        promise.reject("PLAY_FAILED", e.message, e)
      }
    }
  }

  @ReactMethod
  fun playStop(promise: Promise) {
    main.post {
      stopPlayback()
      promise.resolve(true)
    }
  }

  // ---- fingerprint / face ----------------------------------------------------------

  @ReactMethod
  fun biometricAvailable(promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return promise.resolve(false)
      val bm = ctx.getSystemService(BiometricManager::class.java)
      val ok =
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            bm.canAuthenticate(android.hardware.biometrics.BiometricManager.Authenticators.BIOMETRIC_WEAK) == BiometricManager.BIOMETRIC_SUCCESS
          } else {
            @Suppress("DEPRECATION") (bm.canAuthenticate() == BiometricManager.BIOMETRIC_SUCCESS)
          }
      promise.resolve(ok)
    } catch (_: Exception) {
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun biometricAuth(title: String, promise: Promise) {
    val act = currentActivity
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P || act == null) return promise.resolve(false)
    act.runOnUiThread {
      var done = false
      fun finish(ok: Boolean) {
        if (!done) {
          done = true
          promise.resolve(ok)
        }
      }
      try {
        val exec = ContextCompat.getMainExecutor(ctx)
        val prompt =
            BiometricPrompt.Builder(act)
                .setTitle(title)
                .setNegativeButton("Use PIN", exec) { _, _ -> finish(false) }
                .build()
        prompt.authenticate(
            CancellationSignal(),
            exec,
            object : BiometricPrompt.AuthenticationCallback() {
              override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult?) = finish(true)

              override fun onAuthenticationError(errorCode: Int, errString: CharSequence?) = finish(false)
            })
      } catch (_: Exception) {
        finish(false)
      }
    }
  }

  // ---- restart -----------------------------------------------------------------------

  @ReactMethod
  fun restartApp() {
    main.postDelayed(
        {
          val i = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
          if (i != null) {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            ctx.startActivity(i)
          }
          Runtime.getRuntime().exit(0)
        },
        300)
  }

  override fun invalidate() {
    cleanupRecorder(true)
    stopPlayback()
    super.invalidate()
  }

  @ReactMethod fun addListener(eventName: String) {}

  @ReactMethod fun removeListeners(count: Int) {}

  companion object {
    private const val REQ_PICK = 7301
    private const val REQ_SAVE = 7302
  }
}
