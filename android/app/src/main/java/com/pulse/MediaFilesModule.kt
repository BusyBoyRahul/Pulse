package com.pulse

import android.Manifest
import android.app.Activity
import android.content.ContentUris
import android.content.Context
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Typeface
import android.graphics.Matrix
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.media.AudioAttributes
import android.media.ExifInterface
import android.media.MediaMetadataRetriever
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.os.CancellationSignal
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.storage.StorageManager
import android.provider.DocumentsContract
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
import com.facebook.react.bridge.WritableMap
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
  private var pickManyPromise: Promise? = null
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

  /** Pick several files at once (up to `limit`). Resolves {files: [...], skipped: n} — skipped = too large or unreadable. */
  @ReactMethod
  fun pickFiles(mime: String?, maxBytes: Double, limit: Int, startAt: String?, promise: Promise) {
    val act = currentActivity ?: return promise.reject("NO_ACTIVITY", "no screen")
    pickManyPromise?.reject("CANCELLED", "replaced")
    pickManyPromise = promise
    maxPick = maxBytes.toLong()
    maxMany = limit.coerceIn(1, 20)
    val i =
        Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            .setType(if (mime.isNullOrEmpty()) "*/*" else mime)
    // Open Android's file browser straight at a chosen place (Internal storage, SD card, Downloads…)
    if (!startAt.isNullOrEmpty() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      try {
        i.putExtra(DocumentsContract.EXTRA_INITIAL_URI, DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", startAt))
      } catch (_: Exception) {}
    }
    try {
      act.startActivityForResult(i, REQ_PICK_MANY)
    } catch (e: Exception) {
      pickManyPromise = null
      promise.reject("NO_PICKER", e.message, e)
    }
  }

  private var maxPick = 25L * 1024 * 1024
  private var maxMany = 10

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
    } else if (requestCode == REQ_PICK_MANY) {
      val p = pickManyPromise ?: return
      pickManyPromise = null
      val uris = ArrayList<Uri>()
      val clip = data?.clipData
      if (clip != null) {
        for (k in 0 until clip.itemCount) clip.getItemAt(k).uri?.let { uris.add(it) }
      } else {
        data?.data?.let { uris.add(it) }
      }
      if (resultCode != Activity.RESULT_OK || uris.isEmpty()) {
        p.reject("CANCELLED", "cancelled")
        return
      }
      val chosen = uris.take(maxMany)
      val extra = uris.size - chosen.size
      Thread {
            val files = Arguments.createArray()
            var skipped = extra
            for (u in chosen) {
              try {
                files.pushMap(copyOne(u))
              } catch (_: Exception) {
                skipped++
              }
            }
            val out = Arguments.createMap()
            out.putArray("files", files)
            out.putInt("skipped", skipped)
            p.resolve(out)
          }
          .start()
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

  private class PickFail(val code: String, msg: String) : Exception(msg)

  private fun copyPicked(uri: Uri, p: Promise) {
    try {
      p.resolve(copyOne(uri))
    } catch (e: PickFail) {
      p.reject(e.code, e.message)
    } catch (e: Exception) {
      p.reject("PICK_FAILED", e.message, e)
    }
  }

  /** Copy one picked file into Pulse's folder. Throws PickFail (TOO_LARGE / READ_FAILED) or an IO error. */
  private fun copyOne(uri: Uri): WritableMap {
    run {
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
        throw PickFail("TOO_LARGE", size.toString())
      }
      val clean = name.replace(Regex("[^A-Za-z0-9._ -]"), "_").take(80)
      val dest = File(dir(), "${System.currentTimeMillis()}_${System.nanoTime() % 100000}_$clean")
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
              throw PickFail("TOO_LARGE", total.toString())
            }
            out.write(buf, 0, n)
          }
        }
      } ?: throw PickFail("READ_FAILED", "couldn't open the file")
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
      return m
    }
  }

  // ---- places to browse for files ---------------------------------------------------

  /** Internal storage, every mounted SD card / USB drive, plus Downloads and Documents on the main storage. */
  @ReactMethod
  fun storageRoots(promise: Promise) {
    val out = Arguments.createArray()
    fun add(key: String, label: String, kind: String) {
      val m = Arguments.createMap()
      m.putString("key", key)
      m.putString("label", label)
      m.putString("kind", kind)
      out.pushMap(m)
    }
    try {
      var primarySeen = false
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        val sm = ctx.getSystemService(Context.STORAGE_SERVICE) as StorageManager
        for (v in sm.storageVolumes) {
          if (v.state != Environment.MEDIA_MOUNTED) continue
          if (v.isPrimary) {
            primarySeen = true
            add("primary:", "Internal storage", "volume")
          } else {
            val id = v.uuid ?: continue
            add("$id:", v.getDescription(ctx) ?: "SD card", "volume")
          }
        }
      }
      if (!primarySeen) add("primary:", "Internal storage", "volume")
      add("primary:Download", "Downloads", "folder")
      add("primary:Documents", "Documents", "folder")
    } catch (_: Exception) {}
    promise.resolve(out)
  }

  /**
   * Shrinks a picture until its base64 text is at most maxChars long: tries smaller sizes and gentler quality step by step,
   * so any picture can always be used (a Status picture has to fit one small message). Returns the smallest result it could
   * make even if that is still over the limit.
   */
  @ReactMethod
  fun fitJpeg(b64: String, maxChars: Int, promise: Promise) {
    Thread {
          try {
            val bytes = Base64.decode(b64, Base64.NO_WRAP)
            val src = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return@Thread promise.reject("READ_FAILED", "not a picture")
            var best: String? = null
            for (dim in intArrayOf(720, 600, 500, 420, 360, 300, 240, 200)) {
              val scale = dim.toFloat() / maxOf(src.width, src.height)
              val bmp = if (scale < 1f) Bitmap.createScaledBitmap(src, (src.width * scale).toInt().coerceAtLeast(1), (src.height * scale).toInt().coerceAtLeast(1), true) else src
              for (q in intArrayOf(75, 65, 55, 45, 36, 28)) {
                val out = ByteArrayOutputStream()
                bmp.compress(Bitmap.CompressFormat.JPEG, q, out)
                val text = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
                if (best == null || text.length < best.length) best = text
                if (text.length <= maxChars) return@Thread promise.resolve(text)
              }
            }
            promise.resolve(best)
          } catch (e: Exception) {
            promise.reject("FIT_FAILED", e.message, e)
          }
        }
        .start()
  }

  /** A photo turned by a multiple of 90 degrees (clockwise), as a base64 JPEG. */
  @ReactMethod
  fun rotateJpeg(b64: String, degrees: Int, promise: Promise) {
    Thread {
          try {
            val bytes = Base64.decode(b64, Base64.NO_WRAP)
            val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return@Thread promise.reject("READ_FAILED", "not a picture")
            val m = Matrix().apply { postRotate(degrees.toFloat()) }
            val turned = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
            val out = ByteArrayOutputStream()
            turned.compress(Bitmap.CompressFormat.JPEG, 85, out)
            promise.resolve(Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP))
          } catch (e: Exception) {
            promise.reject("ROTATE_FAILED", e.message, e)
          }
        }
        .start()
  }

  /**
   * Bakes the photo editor's work into the picture. `spec` is JSON:
   *   {crop?: {x,y,w,h}, strokes?: [{c: "#RRGGBB", w, p: [x0,y0,x1,y1,...]}], texts?: [{t, c, x, y, s}]}
   * Every number is a fraction of the ORIGINAL picture (w and s are fractions of its width), so the result matches
   * what was on screen at any resolution. Marks are drawn first, then the crop is cut out.
   */
  @ReactMethod
  fun composePhoto(b64: String, spec: String, promise: Promise) {
    Thread {
          try {
            val bytes = Base64.decode(b64, Base64.NO_WRAP)
            val src = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return@Thread promise.reject("READ_FAILED", "not a picture")
            val bmp = src.copy(Bitmap.Config.ARGB_8888, true)
            val canvas = Canvas(bmp)
            val w = bmp.width.toFloat()
            val h = bmp.height.toFloat()
            val j = org.json.JSONObject(spec)

            val strokes = j.optJSONArray("strokes")
            if (strokes != null) {
              for (i in 0 until strokes.length()) {
                val s = strokes.getJSONObject(i)
                val paint =
                    Paint(Paint.ANTI_ALIAS_FLAG).apply {
                      style = Paint.Style.STROKE
                      strokeCap = Paint.Cap.ROUND
                      strokeJoin = Paint.Join.ROUND
                      color = Color.parseColor(s.getString("c"))
                      strokeWidth = (s.getDouble("w") * w).toFloat()
                    }
                val p = s.getJSONArray("p")
                if (p.length() >= 2) {
                  val path = Path()
                  val x0 = (p.getDouble(0) * w).toFloat()
                  val y0 = (p.getDouble(1) * h).toFloat()
                  path.moveTo(x0, y0)
                  if (p.length() == 2) path.lineTo(x0 + 0.1f, y0)
                  var k = 2
                  while (k + 1 < p.length()) {
                    path.lineTo((p.getDouble(k) * w).toFloat(), (p.getDouble(k + 1) * h).toFloat())
                    k += 2
                  }
                  canvas.drawPath(path, paint)
                }
              }
            }

            val texts = j.optJSONArray("texts")
            if (texts != null) {
              for (i in 0 until texts.length()) {
                val t = texts.getJSONObject(i)
                val size = (t.getDouble("s") * w).toFloat()
                val paint =
                    Paint(Paint.ANTI_ALIAS_FLAG).apply {
                      textAlign = Paint.Align.CENTER
                      typeface = Typeface.DEFAULT_BOLD
                      textSize = size
                      color = Color.parseColor(t.getString("c"))
                      setShadowLayer(size * 0.08f, 0f, size * 0.03f, 0x66000000)
                    }
                val lines = t.getString("t").split("\n")
                val lh = size * 1.2f
                val cx = (t.getDouble("x") * w).toFloat()
                val top = (t.getDouble("y") * h).toFloat() - lines.size * lh / 2f
                for ((n, line) in lines.withIndex()) {
                  canvas.drawText(line, cx, top + lh * (n + 0.5f) + size * 0.345f, paint)
                }
              }
            }

            var out = bmp
            val c = j.optJSONObject("crop")
            if (c != null) {
              val x = (c.getDouble("x") * w).toInt().coerceIn(0, bmp.width - 2)
              val y = (c.getDouble("y") * h).toInt().coerceIn(0, bmp.height - 2)
              val cw = (c.getDouble("w") * w).toInt().coerceIn(1, bmp.width - x)
              val ch = (c.getDouble("h") * h).toInt().coerceIn(1, bmp.height - y)
              out = Bitmap.createBitmap(bmp, x, y, cw, ch)
            }
            val buf = ByteArrayOutputStream()
            out.compress(Bitmap.CompressFormat.JPEG, 88, buf)
            promise.resolve(Base64.encodeToString(buf.toByteArray(), Base64.NO_WRAP))
          } catch (e: Exception) {
            promise.reject("COMPOSE_FAILED", e.message, e)
          }
        }
        .start()
  }

  // ---- the in-app gallery ---------------------------------------------------------

  /**
   * The newest photos and videos on the phone, for the picture grid in the attach panel.
   * Needs the "photos and videos" permission; without it this rejects with NO_ACCESS (the screen then explains and offers
   * Android's own picker). Each item: {id, uri, kind: image|video, durationMs}.
   */
  @ReactMethod
  fun recentMedia(limit: Int, promise: Promise) {
    Thread {
          try {
            val out = Arguments.createArray()
            val files = MediaStore.Files.getContentUri("external")
            val typeCol = MediaStore.Files.FileColumns.MEDIA_TYPE
            val withDuration = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            val proj =
                if (withDuration) arrayOf(MediaStore.Files.FileColumns._ID, typeCol, MediaStore.MediaColumns.DURATION)
                else arrayOf(MediaStore.Files.FileColumns._ID, typeCol)
            val sel = "$typeCol IN (?, ?)"
            val args =
                arrayOf(
                    MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE.toString(),
                    MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO.toString())
            ctx.contentResolver.query(files, proj, sel, args, "${MediaStore.Files.FileColumns.DATE_ADDED} DESC")?.use { c ->
              var n = 0
              while (c.moveToNext() && n < limit.coerceIn(1, 300)) {
                val id = c.getLong(0)
                val video = c.getInt(1) == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO
                val base = if (video) MediaStore.Video.Media.EXTERNAL_CONTENT_URI else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                val m = Arguments.createMap()
                m.putString("id", id.toString())
                m.putString("uri", ContentUris.withAppendedId(base, id).toString())
                m.putString("kind", if (video) "video" else "image")
                m.putDouble("durationMs", if (withDuration && video && !c.isNull(2)) c.getLong(2).toDouble() else 0.0)
                out.pushMap(m)
                n++
              }
            }
            promise.resolve(out)
          } catch (e: SecurityException) {
            promise.reject("NO_ACCESS", "photo access is not allowed")
          } catch (e: Exception) {
            promise.reject("GALLERY_FAILED", e.message, e)
          }
        }
        .start()
  }

  /** One gallery photo, made ready to send: turned the right way up, at most maxDim on its long side, as a JPEG (base64). */
  @ReactMethod
  fun galleryPhoto(uriStr: String, maxDim: Int, quality: Int, promise: Promise) {
    Thread {
          try {
            val uri = Uri.parse(uriStr)
            val cr = ctx.contentResolver
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            cr.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return@Thread promise.reject("READ_FAILED", "not a picture")
            var sample = 1
            while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxDim) sample *= 2
            var bmp =
                cr.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
                    ?: return@Thread promise.reject("READ_FAILED", "couldn't open the picture")
            // A picture with see-through parts (a logo, a sticker) must not turn black in a JPEG: put it on white.
            if (bmp.hasAlpha()) {
              val flat = Bitmap.createBitmap(bmp.width, bmp.height, Bitmap.Config.ARGB_8888)
              val c = Canvas(flat)
              c.drawColor(Color.WHITE)
              c.drawBitmap(bmp, 0f, 0f, null)
              bmp = flat
            }
            var degrees = 0
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
              degrees =
                  try {
                    cr.openInputStream(uri)?.use { s ->
                      when (ExifInterface(s).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                        ExifInterface.ORIENTATION_ROTATE_90 -> 90
                        ExifInterface.ORIENTATION_ROTATE_180 -> 180
                        ExifInterface.ORIENTATION_ROTATE_270 -> 270
                        else -> 0
                      }
                    } ?: 0
                  } catch (_: Exception) {
                    0
                  }
            }
            val scale = maxDim.toFloat() / maxOf(bmp.width, bmp.height)
            val matrix = Matrix()
            if (scale < 1f) matrix.postScale(scale, scale)
            if (degrees != 0) matrix.postRotate(degrees.toFloat())
            if (!matrix.isIdentity) bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, matrix, true)
            val out = ByteArrayOutputStream()
            bmp.compress(Bitmap.CompressFormat.JPEG, quality.coerceIn(30, 95), out)
            promise.resolve(Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP))
          } catch (e: SecurityException) {
            promise.reject("NO_ACCESS", "photo access is not allowed")
          } catch (e: Exception) {
            promise.reject("READ_FAILED", e.message, e)
          }
        }
        .start()
  }

  /** Copy one gallery item (a video) into Pulse's folder, the same way a picked file is. */
  @ReactMethod
  fun importUri(uriStr: String, maxBytes: Double, promise: Promise) {
    maxPick = maxBytes.toLong()
    Thread { copyPicked(Uri.parse(uriStr), promise) }.start()
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
  private var recPausedTotal = 0L
  private var recPausedAt = 0L

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
      recPausedTotal = 0L
      recPausedAt = 0L
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
    val now = System.currentTimeMillis()
    val dur = now - recStart - recPausedTotal - (if (recPausedAt > 0) now - recPausedAt else 0L)
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

  /** Pause the recording (keeps what was said so far). */
  @ReactMethod
  fun voicePause(promise: Promise) {
    val r = recorder ?: return promise.reject("NOT_RECORDING", "not recording")
    try {
      if (recPausedAt == 0L) {
        r.pause()
        recPausedAt = System.currentTimeMillis()
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("PAUSE_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun voiceResume(promise: Promise) {
    val r = recorder ?: return promise.reject("NOT_RECORDING", "not recording")
    try {
      if (recPausedAt != 0L) {
        r.resume()
        recPausedTotal += System.currentTimeMillis() - recPausedAt
        recPausedAt = 0L
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("RESUME_FAILED", e.message, e)
    }
  }

  /** How loud it is right now (0..32767), for the live waveform. */
  @ReactMethod
  fun voiceLevel(promise: Promise) {
    val amp = try {
      if (recorder != null && recPausedAt == 0L) recorder!!.maxAmplitude else 0
    } catch (_: Exception) {
      0
    }
    promise.resolve(amp.toDouble())
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
    private const val REQ_PICK_MANY = 7303
    private const val REQ_SAVE = 7302
  }
}
