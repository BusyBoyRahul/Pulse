package com.pulse

import android.content.Intent
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * Shares Pulse's OWN installed .apk so a person nearby can install the app with
 * no internet at all. We copy the running apk into the cache dir, expose it via
 * a FileProvider content:// uri, and fire a normal ACTION_SEND chooser.
 */
class AppShareModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "AppShare"

  @ReactMethod
  fun shareApk(message: String, promise: Promise) {
    try {
      // The apk this app is running from.
      val sourceApk = File(reactContext.applicationInfo.sourceDir)

      // Copy into a cache folder the FileProvider is allowed to expose.
      val outDir = File(reactContext.cacheDir, "shared").apply { mkdirs() }
      val outApk = File(outDir, "Pulse.apk")
      sourceApk.inputStream().use { input ->
        outApk.outputStream().use { output -> input.copyTo(output) }
      }

      val uri =
          FileProvider.getUriForFile(
              reactContext, reactContext.packageName + ".fileprovider", outApk)

      val intent =
          Intent(Intent.ACTION_SEND).apply {
            type = "application/vnd.android.package-archive"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_TEXT, message)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          }

      val chooser =
          Intent.createChooser(intent, "Share Pulse").apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          }
      reactContext.startActivity(chooser)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("SHARE_APK_FAILED", e.message, e)
    }
  }
}
