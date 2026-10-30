package com.pulse

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/** Voice-call audio + Keystore-backed storage encryption + system notifications. */
class PulseNativePackage : ReactPackage {
  override fun createNativeModules(
      reactContext: ReactApplicationContext
  ): List<NativeModule> =
      listOf(
          CallAudioModule(reactContext),
          SecureStoreModule(reactContext),
          NotifyModule(reactContext),
          MediaFilesModule(reactContext))

  override fun createViewManagers(
      reactContext: ReactApplicationContext
  ): List<ViewManager<*, *>> = emptyList()
}
