package com.pulse

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Build
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.android.gms.auth.api.identity.GetPhoneNumberHintIntentRequest
import com.google.android.gms.auth.api.identity.Identity

/**
 * Phone number, chosen by the person from a popup that Android itself shows (the same "choose a phone
 * number" sheet many apps use). The number comes from this phone, not from a text box, so it can't be
 * typed wrong or invented. No text message is sent or read and no SMS permission is needed.
 */
class SmsVerifyModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx), ActivityEventListener {

  private var pending: Promise? = null

  init {
    ctx.addActivityEventListener(this)
  }

  override fun getName() = "PulseSms"

  /** Show the phone's own numbers; resolves with the chosen number (e.g. +919876543210). */
  @ReactMethod
  fun phoneHint(promise: Promise) {
    val act = currentActivity ?: return promise.reject("NO_ACTIVITY", "Pulse is not on screen")
    pending?.reject("CANCELLED", "replaced")
    pending = promise
    try {
      Identity.getSignInClient(act)
          .getPhoneNumberHintIntent(GetPhoneNumberHintIntentRequest.builder().build())
          .addOnSuccessListener { pi ->
            try {
              act.startIntentSenderForResult(pi.intentSender, REQ, null, 0, 0, 0)
            } catch (e: Exception) {
              fail("HINT_FAILED", e.message)
            }
          }
          .addOnFailureListener { fail("HINT_FAILED", it.message) }
    } catch (e: Exception) {
      fail("HINT_FAILED", e.message)
    }
  }

  /**
   * A short fingerprint of the SIM in the phone right now (operator + country + the phone's id for that SIM). It needs
   * no permission and shows no number; it only changes when a different SIM card is put in. Empty if there is no SIM
   * ready to read (no SIM, locked, airplane mode), in which case nobody should be judged.
   */
  @ReactMethod
  fun simSignature(promise: Promise) {
    try {
      val tm = ctx.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
      if (tm.simState != TelephonyManager.SIM_STATE_READY) return promise.resolve("")
      val sub = if (Build.VERSION.SDK_INT >= 24) SubscriptionManager.getDefaultSubscriptionId() else -1
      promise.resolve(listOf(tm.simOperator ?: "", tm.simCountryIso ?: "", sub).joinToString("|"))
    } catch (e: Exception) {
      promise.resolve("")
    }
  }

  private fun fail(code: String, msg: String?) {
    pending?.reject(code, msg ?: "No phone number is available")
    pending = null
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != REQ) return
    val p = pending ?: return
    pending = null
    if (resultCode == Activity.RESULT_OK && data != null) {
      try {
        p.resolve(Identity.getSignInClient(activity).getPhoneNumberFromIntent(data))
      } catch (e: Exception) {
        p.reject("HINT_FAILED", e.message ?: "No phone number is available")
      }
    } else {
      p.reject("CANCELLED", "closed")
    }
  }

  override fun onNewIntent(intent: Intent) {}

  @ReactMethod fun addListener(eventName: String) {}

  @ReactMethod fun removeListeners(count: Int) {}

  override fun invalidate() {
    ctx.removeActivityEventListener(this)
    super.invalidate()
  }

  companion object {
    private const val REQ = 4712
  }
}
