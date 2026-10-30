package com.pulse

import android.content.Intent
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "Pulse"

  // react-native-screens: pass null to avoid a crash restoring navigation state.
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
    // Opened by tapping a notification (cold start): hold the tap until JS is ready.
    NotifyBridge.fromIntent(intent)?.let { NotifyBridge.dispatch(it) }
  }

  // Tapping a notification while Pulse is already running.
  override fun onNewIntent(intent: Intent?) {
    super.onNewIntent(intent)
    setIntent(intent)
    NotifyBridge.fromIntent(intent)?.let { NotifyBridge.dispatch(it) }
  }

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
