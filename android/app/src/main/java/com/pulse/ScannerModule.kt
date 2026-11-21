package com.pulse

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

/**
 * Scan a QR code with Google's built-in scanner screen. It needs no camera permission
 * (the scanner runs in Google Play services) and no network. Resolves with the text in
 * the code, or rejects with CANCELLED if the user backs out.
 */
class ScannerModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

  override fun getName() = "PulseScanner"

  @ReactMethod
  fun scan(promise: Promise) {
    val activity = currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "Pulse is not on screen")
      return
    }
    val options =
        GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
    GmsBarcodeScanning.getClient(activity, options)
        .startScan()
        .addOnSuccessListener { promise.resolve(it.rawValue) }
        .addOnCanceledListener { promise.reject("CANCELLED", "Cancelled") }
        .addOnFailureListener { promise.reject("SCAN_FAILED", it.message ?: "Could not scan", it) }
  }
}
