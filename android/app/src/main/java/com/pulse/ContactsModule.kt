package com.pulse

import android.content.Context
import android.provider.ContactsContract
import android.telephony.PhoneNumberUtils
import android.telephony.TelephonyManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.Locale

/**
 * Reads the phone's address book so Pulse can ask "which of my contacts are on Pulse?".
 * Numbers are turned into international form (+15551234567) here; JS hashes them before
 * anything leaves the phone. Nothing is stored or uploaded by this module.
 */
class ContactsModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

  override fun getName() = "PulseContacts"

  private fun homeCountry(): String {
    val tm = ctx.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
    val iso = tm?.simCountryIso?.takeIf { it.isNotBlank() } ?: tm?.networkCountryIso?.takeIf { it.isNotBlank() }
    return (iso ?: Locale.getDefault().country).uppercase(Locale.ROOT)
  }

  @ReactMethod
  fun read(promise: Promise) {
    Thread {
          try {
            val country = homeCountry()
            val seen = HashSet<String>()
            val out = Arguments.createArray()
            val cursor =
                ctx.contentResolver.query(
                    ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                    arrayOf(
                        ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                        ContactsContract.CommonDataKinds.Phone.NUMBER),
                    null,
                    null,
                    null)
            cursor?.use {
              val nameIx = it.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
              val numIx = it.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
              while (it.moveToNext()) {
                val raw = it.getString(numIx) ?: continue
                val e164 = PhoneNumberUtils.formatNumberToE164(raw, country) ?: continue
                if (!seen.add(e164)) continue
                val m = Arguments.createMap()
                m.putString("name", it.getString(nameIx) ?: "")
                m.putString("number", e164)
                out.pushMap(m)
              }
            }
            promise.resolve(out)
          } catch (e: Exception) {
            promise.reject("CONTACTS_FAILED", e.message ?: "Could not read contacts", e)
          }
        }
        .start()
  }
}
