package com.pulse

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * At-rest encryption for the sensitive bits of local storage (the mesh secret
 * key, phone numbers, trusted contacts, group keys, chat history).
 *
 * The AES-256 key is generated INSIDE the Android Keystore and is never
 * exposed to the app or to disk — even someone who copies the app's data folder
 * (a backup, a rooted shell, a lost phone's storage) only gets ciphertext.
 */
class SecureStoreModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "SecureStore"

  private fun key(): SecretKey {
    val ks = KeyStore.getInstance(PROVIDER).apply { load(null) }
    (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER)
    gen.init(
        KeyGenParameterSpec.Builder(
                ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build())
    return gen.generateKey()
  }

  /** plaintext -> base64(iv || ciphertext+tag) */
  @ReactMethod
  fun encrypt(plain: String, promise: Promise) {
    try {
      val c = Cipher.getInstance(TRANSFORM)
      c.init(Cipher.ENCRYPT_MODE, key())
      val iv = c.iv
      val ct = c.doFinal(plain.toByteArray(StandardCharsets.UTF_8))
      promise.resolve(Base64.encodeToString(iv + ct, Base64.NO_WRAP))
    } catch (e: Exception) {
      promise.reject("SECURE_ENCRYPT_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun decrypt(blob: String, promise: Promise) {
    try {
      val raw = Base64.decode(blob, Base64.NO_WRAP)
      val iv = raw.copyOfRange(0, IV_LEN)
      val ct = raw.copyOfRange(IV_LEN, raw.size)
      val c = Cipher.getInstance(TRANSFORM)
      c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
      promise.resolve(String(c.doFinal(ct), StandardCharsets.UTF_8))
    } catch (e: Exception) {
      promise.reject("SECURE_DECRYPT_FAILED", e.message, e)
    }
  }

  companion object {
    private const val PROVIDER = "AndroidKeyStore"
    private const val ALIAS = "pulse_storage_key_v1"
    private const val TRANSFORM = "AES/GCM/NoPadding"
    private const val IV_LEN = 12
  }
}
