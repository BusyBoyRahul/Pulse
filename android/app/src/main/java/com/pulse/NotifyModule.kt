package com.pulse

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Base64
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.core.graphics.drawable.IconCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Pulse's real Android notifications: messages (with inline Reply), SOS alerts,
 * incoming calls (Answer / Decline), connect requests and photo transfers — in
 * the notification shade, on the lock screen and as heads-up banners, with the
 * user's own per-channel sound / vibration choices in system settings.
 *
 * Taps and action buttons travel back to JS as "PulseNotifAction" events. If JS
 * isn't listening yet (cold start) they wait in a queue until it calls ready().
 */
object NotifyBridge {
  @Volatile var ctx: ReactApplicationContext? = null
  private var ready = false
  private val queue = ArrayList<Map<String, String>>()

  fun dispatch(data: Map<String, String>) {
    val c = ctx
    synchronized(queue) {
      if (ready && c != null && c.hasActiveReactInstance()) {
        emit(c, data)
      } else {
        queue.add(data)
        while (queue.size > 30) queue.removeAt(0)
      }
    }
  }

  /** JS is now listening: hand over everything that arrived before. */
  fun ready(): List<Map<String, String>> =
      synchronized(queue) {
        ready = true
        val out = ArrayList(queue)
        queue.clear()
        out
      }

  fun reset() = synchronized(queue) { ready = false }

  private fun emit(c: ReactApplicationContext, data: Map<String, String>) {
    val m = Arguments.createMap()
    data.forEach { (k, v) -> m.putString(k, v) }
    c.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("PulseNotifAction", m)
  }

  /** Pulls our "pulse.*" extras out of an intent (and removes them so they only fire once). */
  fun fromIntent(intent: Intent?): Map<String, String>? {
    val extras = intent?.extras ?: return null
    // Android re-delivers the old launch intent when an app comes back from recents
    // after being killed — that is not a new tap.
    val fromHistory = (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0
    val out = HashMap<String, String>()
    for (k in extras.keySet().toList()) {
      if (k.startsWith("pulse.")) {
        extras.getString(k)?.let { out[k.removePrefix("pulse.")] = it }
        intent.removeExtra(k)
      }
    }
    if (out.isEmpty() || fromHistory) return null
    out["at"] = System.currentTimeMillis().toString()
    return out
  }
}

object NotifyHelper {
  const val CH_MESSAGES = "pulse_messages"
  const val CH_SOS = "pulse_sos"
  const val CH_CALLS = "pulse_calls_v2"
  const val CH_REQUESTS = "pulse_requests"
  const val CH_TRANSFERS = "pulse_transfers"
  const val CH_MESH = "pulse_mesh"
  const val CH_CALL_ONGOING = "pulse_call_ongoing"
  const val INCOMING_CALL_ID = 4712
  const val ONGOING_ID = 4711
  const val ACCENT = 0xFF8E8E96.toInt()

  fun ensureChannels(ctx: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = ctx.getSystemService(NotificationManager::class.java)

    fun make(id: String, name: String, importance: Int, desc: String, block: NotificationChannel.() -> Unit = {}) {
      if (mgr.getNotificationChannel(id) != null) return
      mgr.createNotificationChannel(
          NotificationChannel(id, name, importance).apply {
            description = desc
            block()
          })
    }

    make(CH_MESSAGES, "Messages", NotificationManager.IMPORTANCE_HIGH, "New messages from people you're connected to") {
      enableVibration(true)
      enableLights(true)
    }
    make(CH_SOS, "SOS alerts", NotificationManager.IMPORTANCE_HIGH, "Someone nearby needs help") {
      enableVibration(true)
      vibrationPattern = longArrayOf(0, 600, 250, 600, 250, 600)
      setBypassDnd(true)
      setSound(
          RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
          AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_ALARM)
              .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
              .build())
    }
    make(CH_CALLS, "Calls", NotificationManager.IMPORTANCE_HIGH, "Incoming Pulse calls") {
      enableVibration(true)
      vibrationPattern = longArrayOf(0, 700, 500, 700, 500)
      setSound(
          RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
          AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
              .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
              .build())
    }
    make(CH_REQUESTS, "Connect requests & invites", NotificationManager.IMPORTANCE_DEFAULT, "People asking to connect, and group invites")
    make(CH_TRANSFERS, "Photo transfers", NotificationManager.IMPORTANCE_LOW, "Progress of photos being sent or received") {
      setShowBadge(false)
    }
    make(CH_MESH, "Mesh relay", NotificationManager.IMPORTANCE_LOW, "Shown while Pulse is relaying for people nearby") {
      setShowBadge(false)
    }
    make(CH_CALL_ONGOING, "Ongoing call", NotificationManager.IMPORTANCE_LOW, "Shown while you're on a Pulse call") {
      setShowBadge(false)
    }
  }

  fun channelIdFor(key: String): String = channelId(key)

  private fun channelId(key: String): String =
      when (key) {
        "messages" -> CH_MESSAGES
        "sos" -> CH_SOS
        "calls" -> CH_CALLS
        "requests" -> CH_REQUESTS
        "transfers" -> CH_TRANSFERS
        else -> CH_MESSAGES
      }

  fun openApp(ctx: Context, requestCode: Int, extras: Map<String, String>): PendingIntent {
    val i =
        Intent(ctx, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .setAction("pulse.open.$requestCode")
    extras.forEach { (k, v) -> i.putExtra("pulse.$k", v) }
    return PendingIntent.getActivity(ctx, requestCode, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  fun broadcast(ctx: Context, requestCode: Int, extras: Map<String, String>, mutable: Boolean = false): PendingIntent {
    val i = Intent(ctx, NotifyActionReceiver::class.java).setAction("pulse.act.$requestCode")
    extras.forEach { (k, v) -> i.putExtra("pulse.$k", v) }
    val flags =
        PendingIntent.FLAG_UPDATE_CURRENT or
            (if (mutable && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE
            else PendingIntent.FLAG_IMMUTABLE)
    return PendingIntent.getBroadcast(ctx, requestCode, i, flags)
  }

  private fun str(m: ReadableMap, k: String): String? =
      if (m.hasKey(k) && m.getType(k) == ReadableType.String) m.getString(k) else null

  private fun bool(m: ReadableMap, k: String): Boolean = m.hasKey(k) && !m.isNull(k) && m.getBoolean(k)

  private fun circle(bmp: Bitmap): Bitmap {
    val size = minOf(bmp.width, bmp.height)
    val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val c = Canvas(out)
    val p = Paint(Paint.ANTI_ALIAS_FLAG)
    c.drawCircle(size / 2f, size / 2f, size / 2f, p)
    p.xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_IN)
    c.drawBitmap(bmp, (size - bmp.width) / 2f, (size - bmp.height) / 2f, p)
    return out
  }

  private fun avatar(b64: String?): Bitmap? {
    if (b64.isNullOrEmpty()) return null
    return try {
      val raw = Base64.decode(b64.substringAfter("base64,"), Base64.DEFAULT)
      BitmapFactory.decodeByteArray(raw, 0, raw.size)?.let { circle(it) }
    } catch (_: Exception) {
      null
    }
  }

  /** Builds and posts a notification from the JS description. */
  fun show(ctx: Context, o: ReadableMap) {
    ensureChannels(ctx)
    val id = o.getInt("id")
    val channel = str(o, "channel") ?: "messages"
    val title = str(o, "title") ?: "Pulse"
    val text = str(o, "text") ?: ""
    val silent = bool(o, "silent")
    val hideText = bool(o, "hideText")
    val isGroup = bool(o, "isGroup")
    val ongoing = bool(o, "ongoing")
    val convId = str(o, "convId") ?: ""
    val kind = str(o, "kind") ?: ""
    val sender = str(o, "sender")
    val avatarBmp = avatar(str(o, "avatar"))
    val whenMs = if (o.hasKey("when")) o.getDouble("when").toLong() else System.currentTimeMillis()

    val tapExtras = mapOf("action" to "open", "id" to id.toString(), "conv" to convId, "kind" to kind, "title" to title, "type" to (str(o, "type") ?: ""))
    val b =
        NotificationCompat.Builder(ctx, channelId(channel))
            .setSmallIcon(R.drawable.ic_stat_pulse)
            .setColor(ACCENT)
            .setContentTitle(title)
            .setContentText(if (hideText) "New message" else text)
            .setWhen(whenMs)
            .setShowWhen(true)
            .setAutoCancel(!ongoing)
            .setOngoing(ongoing)
            .setOnlyAlertOnce(bool(o, "onlyAlertOnce"))
            .setContentIntent(openApp(ctx, id, tapExtras))
            .setPriority(
                when (channel) {
                  "transfers" -> NotificationCompat.PRIORITY_LOW
                  "requests" -> NotificationCompat.PRIORITY_DEFAULT
                  else -> NotificationCompat.PRIORITY_HIGH
                })
    if (silent) b.setSilent(true)
    str(o, "group")?.let { b.setGroup(it) }
    when (channel) {
      "messages" -> b.setCategory(NotificationCompat.CATEGORY_MESSAGE)
      "sos" -> b.setCategory(NotificationCompat.CATEGORY_ALARM)
      "calls" -> b.setCategory(NotificationCompat.CATEGORY_CALL)
      "requests" -> b.setCategory(NotificationCompat.CATEGORY_SOCIAL)
      "transfers" -> b.setCategory(NotificationCompat.CATEGORY_PROGRESS)
    }
    if (o.hasKey("timeoutMs") && !o.isNull("timeoutMs")) b.setTimeoutAfter(o.getDouble("timeoutMs").toLong())
    if (o.hasKey("progress") && !o.isNull("progress")) b.setProgress(100, (o.getDouble("progress") * 100).toInt(), false)
    if (avatarBmp != null) b.setLargeIcon(avatarBmp)

    // Conversation style: shows the last few lines stacked, like any chat app.
    val lines: ReadableArray? = if (o.hasKey("lines")) o.getArray("lines") else null
    if (channel == "messages" && lines != null && lines.size() > 0 && !hideText) {
      val me = Person.Builder().setName("You").build()
      val style = NotificationCompat.MessagingStyle(me)
      if (isGroup) {
        style.conversationTitle = title
        style.isGroupConversation = true
      }
      for (i in 0 until lines.size()) {
        val l = lines.getMap(i) ?: continue
        val pb = Person.Builder().setName(l.getString("sender") ?: sender ?: title)
        if (avatarBmp != null && !isGroup) pb.setIcon(IconCompat.createWithBitmap(avatarBmp))
        style.addMessage(l.getString("text") ?: "", l.getDouble("at").toLong(), pb.build())
      }
      b.setStyle(style)
    } else if (text.length > 40 && !hideText) {
      b.setStyle(NotificationCompat.BigTextStyle().bigText(text))
    }

    // Lock screen: show the basics, keep the words private unless the user allows them.
    b.setVisibility(if (channel == "messages") NotificationCompat.VISIBILITY_PRIVATE else NotificationCompat.VISIBILITY_PUBLIC)
    if (channel == "messages") {
      b.setPublicVersion(
          NotificationCompat.Builder(ctx, channelId(channel))
              .setSmallIcon(R.drawable.ic_stat_pulse)
              .setColor(ACCENT)
              .setContentTitle("Pulse")
              .setContentText("New message")
              .build())
    }

    // Action buttons.
    val acts: ReadableArray? = if (o.hasKey("actions")) o.getArray("actions") else null
    if (acts != null) {
      for (i in 0 until acts.size()) {
        val a = acts.getMap(i) ?: continue
        val aid = a.getString("id") ?: continue
        val label = a.getString("label") ?: aid
        val extras = mapOf("action" to aid, "id" to id.toString(), "conv" to convId, "kind" to kind, "title" to title)
        val rc = id * 31 + aid.hashCode()
        val input = bool(a, "input")
        val pi =
            if (bool(a, "opens")) openApp(ctx, rc, extras)
            else broadcast(ctx, rc, extras, mutable = input)
        val builder = NotificationCompat.Action.Builder(0, label, pi)
        if (input) {
          builder.addRemoteInput(RemoteInput.Builder("pulse_reply").setLabel(label).build())
          builder.setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
          builder.setShowsUserInterface(false)
        } else if (aid == "read") {
          builder.setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
          builder.setShowsUserInterface(false)
        }
        b.addAction(builder.build())
      }
    }

    try {
      NotificationManagerCompat.from(ctx).notify(id, b.build())
    } catch (_: SecurityException) {
      // Notifications not allowed (Android 13+ permission denied): nothing to show.
    }
  }

  /** The ring for an incoming call: ringtone, vibration, Answer / Decline. */
  fun showIncomingCall(ctx: Context, name: String) {
    ensureChannels(ctx)
    val tap = mapOf("action" to "openCall", "id" to INCOMING_CALL_ID.toString(), "kind" to "call", "title" to name)
    val answer = mapOf("action" to "answer", "id" to INCOMING_CALL_ID.toString(), "kind" to "call", "title" to name)
    val decline = mapOf("action" to "decline", "id" to INCOMING_CALL_ID.toString(), "kind" to "call", "title" to name)
    val n =
        NotificationCompat.Builder(ctx, CH_CALLS)
            .setSmallIcon(R.drawable.ic_stat_pulse)
            .setColor(ACCENT)
            .setContentTitle(name)
            .setContentText("Incoming Pulse call")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setTimeoutAfter(45_000)
            .setContentIntent(openApp(ctx, INCOMING_CALL_ID, tap))
            .addAction(NotificationCompat.Action.Builder(0, "Decline", broadcast(ctx, INCOMING_CALL_ID * 31 + 1, decline)).build())
            .addAction(NotificationCompat.Action.Builder(0, "Answer", openApp(ctx, INCOMING_CALL_ID * 31 + 2, answer)).build())
            .build()
    try {
      NotificationManagerCompat.from(ctx).notify(INCOMING_CALL_ID, n)
    } catch (_: SecurityException) {}
  }

  fun cancel(ctx: Context, id: Int) {
    try {
      NotificationManagerCompat.from(ctx).cancel(id)
    } catch (_: Exception) {}
  }
}

/** Buttons on a notification that don't need the screen (Reply, Mark read, Decline, Accept…). */
class NotifyActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val data = NotifyBridge.fromIntent(intent)?.toMutableMap() ?: return
    RemoteInput.getResultsFromIntent(intent)?.getCharSequence("pulse_reply")?.toString()?.let { data["text"] = it }
    NotifyBridge.dispatch(data)
    val id = data["id"]?.toIntOrNull() ?: return
    // These finish the notification (a sent reply shouldn't leave a spinner behind).
    if (data["action"] in setOf("reply", "read", "decline", "accept", "ignore", "dismiss")) {
      NotifyHelper.cancel(context, id)
    }
  }
}

class NotifyModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

  override fun getName(): String = "PulseNotify"

  override fun initialize() {
    super.initialize()
    NotifyBridge.ctx = ctx
    NotifyHelper.ensureChannels(ctx)
  }

  override fun invalidate() {
    NotifyBridge.reset()
    super.invalidate()
  }

  /** JS is listening; returns taps/actions that happened before it was. */
  @ReactMethod
  fun ready(promise: Promise) {
    NotifyBridge.ctx = ctx
    NotifyBridge.fromIntent(currentActivity?.intent)?.let { NotifyBridge.dispatch(it) }
    val arr = Arguments.createArray()
    NotifyBridge.ready().forEach { d ->
      val m = Arguments.createMap()
      d.forEach { (k, v) -> m.putString(k, v) }
      arr.pushMap(m)
    }
    promise.resolve(arr)
  }

  @ReactMethod
  fun show(opts: ReadableMap) {
    try {
      NotifyHelper.show(ctx, opts)
    } catch (_: Exception) {}
  }

  @ReactMethod
  fun cancel(id: Int) = NotifyHelper.cancel(ctx, id)

  @ReactMethod
  fun cancelAll() {
    try {
      NotificationManagerCompat.from(ctx).cancelAll()
    } catch (_: Exception) {}
  }

  @ReactMethod
  fun areEnabled(promise: Promise) {
    promise.resolve(
        try {
          NotificationManagerCompat.from(ctx).areNotificationsEnabled()
        } catch (_: Exception) {
          true
        })
  }

  @ReactMethod
  fun openChannelSettings(channelKey: String?) {
    val intent =
        if (channelKey != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
              .putExtra(Settings.EXTRA_CHANNEL_ID, NotifyHelper.channelIdFor(channelKey))
        } else {
          Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
        }
    intent.putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      ctx.startActivity(intent)
    } catch (_: Exception) {}
  }

  /** Blocks screenshots and hides Pulse's picture in the recent-apps list. */
  @ReactMethod
  fun setSecure(on: Boolean) {
    val act = currentActivity ?: return
    act.runOnUiThread {
      if (on) act.window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
      else act.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }
  }

  @ReactMethod
  fun isBatteryUnrestricted(promise: Promise) {
    promise.resolve(
        try {
          ctx.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(ctx.packageName)
        } catch (_: Exception) {
          false
        })
  }

  /** Asks Android to let Pulse keep running in the background (so it can relay). */
  @ReactMethod
  fun requestBatteryUnrestricted() {
    val first =
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
            .setData(Uri.parse("package:${ctx.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      ctx.startActivity(first)
    } catch (_: Exception) {
      try {
        ctx.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      } catch (_: Exception) {}
    }
  }

  @ReactMethod fun addListener(eventName: String) {}

  @ReactMethod fun removeListeners(count: Int) {}
}
