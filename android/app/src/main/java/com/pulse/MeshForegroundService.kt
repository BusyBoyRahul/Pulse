package com.pulse

import android.app.Notification
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * A quiet, ongoing notification whose only job is to keep Pulse's process alive
 * so this phone keeps relaying other people's messages and SOS alerts with the
 * screen off. Without it Android suspends the app within minutes and the
 * A→B→C chain silently breaks at B.
 *
 * During a voice call the same service switches to "call" mode: the notification
 * becomes "Call in progress" with a Hang up button, and the service declares the
 * microphone type — Android silences the mic of an app that has left the screen
 * unless a microphone foreground service is running.
 */
class MeshForegroundService : Service() {

  private var inCall = false

  override fun onCreate() {
    super.onCreate()
    instance = this
  }

  override fun onDestroy() {
    if (instance === this) instance = null
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    inCall = intent?.getStringExtra("mode") == "call" || inCall
    promote()
    return START_STICKY
  }

  /** Switch between the everyday relay notice and the in-call notice. */
  fun setCall(on: Boolean) {
    inCall = on
    promote()
  }

  private fun promote() {
    NotifyHelper.ensureChannels(this)
    val notification = if (inCall) callNotification() else meshNotification()
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val type =
            if (inCall) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            else ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
        startForeground(NotifyHelper.ONGOING_ID, notification, type)
      } else {
        startForeground(NotifyHelper.ONGOING_ID, notification)
      }
    } catch (e: Exception) {
      if (inCall) {
        // The microphone type was refused (started from the background): fall back to relay mode.
        inCall = false
        try {
          promote()
        } catch (_: Exception) {}
      } else {
        // Permission not granted yet / background-start restriction: carry on without it.
        stopSelf()
      }
    }
  }

  private fun meshNotification(): Notification =
      NotificationCompat.Builder(this, NotifyHelper.CH_MESH)
          .setContentTitle("Pulse mesh is on")
          .setContentText("Relaying messages and alerts for people nearby")
          .setSmallIcon(R.drawable.ic_stat_pulse)
          .setColor(NotifyHelper.ACCENT)
          .setOngoing(true)
          .setShowWhen(false)
          .setPriority(NotificationCompat.PRIORITY_LOW)
          .setCategory(NotificationCompat.CATEGORY_SERVICE)
          .setContentIntent(NotifyHelper.openApp(this, 0, mapOf("action" to "openNearby")))
          .build()

  private fun callNotification(): Notification =
      NotificationCompat.Builder(this, NotifyHelper.CH_CALL_ONGOING)
          .setContentTitle("Pulse call in progress")
          .setContentText("Tap to return to the call")
          .setSmallIcon(R.drawable.ic_stat_pulse)
          .setColor(NotifyHelper.ACCENT)
          .setOngoing(true)
          .setUsesChronometer(true)
          .setWhen(System.currentTimeMillis())
          .setPriority(NotificationCompat.PRIORITY_LOW)
          .setCategory(NotificationCompat.CATEGORY_CALL)
          .setContentIntent(NotifyHelper.openApp(this, 1, mapOf("action" to "openCall")))
          .addAction(
              NotificationCompat.Action.Builder(
                      0,
                      "Hang up",
                      NotifyHelper.broadcast(
                          this, 2, mapOf("action" to "hangup", "id" to NotifyHelper.ONGOING_ID.toString(), "kind" to "call")))
                  .build())
          .build()

  companion object {
    @Volatile var instance: MeshForegroundService? = null

    /** Called by the call-audio engine when a call starts (true) or ends (false). */
    fun callMode(ctx: android.content.Context, on: Boolean) {
      val running = instance
      if (running != null) {
        running.setCall(on)
        return
      }
      if (!on) return
      try {
        val i = Intent(ctx, MeshForegroundService::class.java).putExtra("mode", "call")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
      } catch (_: Exception) {}
    }
  }
}
