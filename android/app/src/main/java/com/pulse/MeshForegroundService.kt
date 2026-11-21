package com.pulse

import android.app.Notification
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Runs only DURING a voice call: the notification is "Call in progress" with a Hang up button, and the service declares the
 * microphone type — Android silences the mic of an app that has left the screen unless a microphone foreground service is
 * running. It no longer runs the rest of the time, so there is no permanent "running in the background" notification
 * (Android makes any foreground service show one).
 */
class MeshForegroundService : Service() {

  private var inCall = false
  private var boosting = false
  private val handler = android.os.Handler(android.os.Looper.getMainLooper())

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
    if (intent?.getStringExtra("mode") == "mesh" && !inCall) {
      // The person just switched the mesh on: run as a foreground service for a few seconds while the radio starts (this is what
      // lets Android / Google's Nearby switch Wi-Fi on), then go away. No permanent notification.
      boosting = true
      promoteBoost()
      handler.removeCallbacksAndMessages(null)
      handler.postDelayed({
        if (boosting && !inCall) {
          boosting = false
          stopForegroundCompat()
          stopSelf()
        }
      }, 12000)
      return START_NOT_STICKY
    }
    inCall = intent?.getStringExtra("mode") == "call" || inCall
    if (!inCall) {
      // Started for any other reason (an old restart): there is nothing to keep running, so go away without a notice.
      stopSelf()
      return START_NOT_STICKY
    }
    promote()
    return START_NOT_STICKY
  }

  /** The call began (true) or ended (false). When it ends, the service and its notification end with it. */
  fun setCall(on: Boolean) {
    boosting = false
    inCall = on
    if (on) {
      promote()
    } else {
      stopForegroundCompat()
      stopSelf()
    }
  }

  private fun promoteBoost() {
    NotifyHelper.ensureChannels(this)
    val n =
        NotificationCompat.Builder(this, NotifyHelper.CH_MESH)
            .setContentTitle("Pulse")
            .setContentText("Starting the mesh…")
            .setSmallIcon(R.drawable.ic_stat_pulse)
            .setColor(NotifyHelper.ACCENT)
            .setOngoing(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NotifyHelper.ONGOING_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
      } else {
        startForeground(NotifyHelper.ONGOING_ID, n)
      }
    } catch (_: Exception) {
      boosting = false
      stopSelf()
    }
  }

  private fun stopForegroundCompat() {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(Service.STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
    } catch (_: Exception) {}
  }

  private fun promote() {
    NotifyHelper.ensureChannels(this)
    val notification = callNotification()
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
      // The microphone type was refused (started from the background): try once without it, else carry on without a service.
      try {
        startForeground(NotifyHelper.ONGOING_ID, notification)
      } catch (_: Exception) {
        stopSelf()
      }
    }
  }

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
