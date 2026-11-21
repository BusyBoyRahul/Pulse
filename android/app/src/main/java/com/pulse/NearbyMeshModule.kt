package com.pulse

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.AdvertisingOptions
import com.google.android.gms.nearby.connection.ConnectionInfo
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback
import com.google.android.gms.nearby.connection.ConnectionResolution
import com.google.android.gms.nearby.connection.ConnectionsClient
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo
import com.google.android.gms.nearby.connection.DiscoveryOptions
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback
import com.google.android.gms.nearby.connection.Payload
import com.google.android.gms.nearby.connection.PayloadCallback
import com.google.android.gms.nearby.connection.PayloadTransferUpdate
import com.google.android.gms.nearby.connection.Strategy
import java.nio.charset.StandardCharsets
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArraySet

/**
 * Offline peer-to-peer transport built on Google Nearby Connections. Every phone
 * both advertises and discovers under one service id; when two phones see each
 * other they auto-connect (over whichever of Bluetooth / Wi-Fi is fastest) and
 * exchange opaque "wire" strings — the same frames the JS MeshEngine relays.
 *
 * No server, no account, no internet. Emits three JS events:
 *   NearbyEndpoints  — the current set of connected peers changed
 *   NearbyPayload    — an inbound wire string arrived
 *   NearbyState      — transport state changed (active / idle / error)
 *
 * Reliability notes (a relay phone must keep links up for A→B→C to work):
 *  - a failed connection request is retried with back-off while the peer is
 *    still visible, and the "larger name" side also tries after a grace delay,
 *    so a lost tie-break can never leave two nearby phones unconnected;
 *  - a dropped link is re-dialled as soon as the peer is visible again;
 *  - discovery/advertising are refreshed on demand (JS calls refresh()) because
 *    long-running Nearby discovery can go stale on some OEMs.
 */
class NearbyMeshModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  private val client: ConnectionsClient by lazy { Nearby.getConnectionsClient(reactContext) }
  private val main = Handler(Looper.getMainLooper())

  private var localName: String = "pulse"
  private var running = false
  // JS wants the radio on. Switching the phone's Wi-Fi / Bluetooth ON (which Nearby does by itself when it needs them) happens ONLY
  // when the person has just switched the mesh on in the app (allowPowerOn). Any other start - Pulse opening with the mesh already
  // on - waits until the person turns Wi-Fi and Bluetooth on themselves. If they turn one off, the radio lets go and does not power
  // it back on until they switch the mesh on again.
  private var wanted = false
  private var allowPowerOn = false
  private var sawRadiosOn = false
  private var radioReceiver: BroadcastReceiver? = null
  // Touched from both Nearby's main-thread callbacks and the RN bridge thread
  // (send()), so all of these must be thread-safe to avoid a mid-send crash.
  private val connected = CopyOnWriteArraySet<String>()
  private val connecting = CopyOnWriteArraySet<String>()
  private val discovered = ConcurrentHashMap<String, String>() // endpointId -> name
  private val endpointNames = ConcurrentHashMap<String, String>()
  private val attempts = ConcurrentHashMap<String, Int>()

  override fun getName(): String = "NearbyMesh"

  // ---- JS event helpers ---------------------------------------------------

  private fun emit(event: String, data: Any?) {
    if (!reactContext.hasActiveReactInstance()) return
    reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(event, data)
  }

  private fun emitEndpoints() {
    val arr = Arguments.createArray()
    for (id in connected) {
      val m = Arguments.createMap()
      m.putString("deviceId", id)
      m.putString("name", endpointNames[id] ?: "")
      arr.pushMap(m)
    }
    emit("NearbyEndpoints", arr)
  }

  private fun stateMap(state: String, error: String?): WritableMap {
    val m = Arguments.createMap()
    m.putString("state", state)
    if (error != null) m.putString("error", error)
    return m
  }

  // ---- Connecting ---------------------------------------------------------

  private fun dial(endpointId: String) {
    if (!running || connected.contains(endpointId) || !connecting.add(endpointId)) return
    client
        .requestConnection(localName, endpointId, connectionLifecycle)
        .addOnFailureListener {
          connecting.remove(endpointId)
          retryLater(endpointId)
        }
  }

  private fun retryLater(endpointId: String) {
    val n = (attempts[endpointId] ?: 0) + 1
    attempts[endpointId] = n
    if (n > MAX_ATTEMPTS) return
    main.postDelayed(
        {
          if (running && discovered.containsKey(endpointId) && !connected.contains(endpointId)) {
            dial(endpointId)
          }
        },
        RETRY_BASE_MS * n)
  }

  // ---- Nearby callbacks ---------------------------------------------------

  private val payloadCallback =
      object : PayloadCallback() {
        override fun onPayloadReceived(endpointId: String, payload: Payload) {
          if (payload.type == Payload.Type.BYTES) {
            val bytes = payload.asBytes() ?: return
            val m = Arguments.createMap()
            m.putString("wire", String(bytes, StandardCharsets.UTF_8))
            m.putString("from", endpointId)
            emit("NearbyPayload", m)
          }
        }

        override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) {}
      }

  private val connectionLifecycle =
      object : ConnectionLifecycleCallback() {
        override fun onConnectionInitiated(endpointId: String, info: ConnectionInfo) {
          endpointNames[endpointId] = info.endpointName
          // Auto-accept — this is an open safety mesh, consent lives a layer up.
          client.acceptConnection(endpointId, payloadCallback)
        }

        override fun onConnectionResult(endpointId: String, result: ConnectionResolution) {
          connecting.remove(endpointId)
          if (result.status.isSuccess) {
            attempts.remove(endpointId)
            connected.add(endpointId)
            emitEndpoints()
          } else {
            retryLater(endpointId)
          }
        }

        override fun onDisconnected(endpointId: String) {
          connected.remove(endpointId)
          connecting.remove(endpointId)
          emitEndpoints()
          // Still in range? Re-dial rather than wait for a rediscovery that may
          // never be reported.
          if (running && discovered.containsKey(endpointId)) {
            main.postDelayed({ dial(endpointId) }, RETRY_BASE_MS)
          }
        }
      }

  private val discoveryCallback =
      object : EndpointDiscoveryCallback() {
        override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
          discovered[endpointId] = info.endpointName
          if (connected.contains(endpointId)) return
          endpointNames[endpointId] = info.endpointName
          // Both phones advertise AND discover, so both could request a
          // connection at once and collide. Break the tie deterministically:
          // the lexicographically-smaller name initiates immediately. The other
          // side only dials after a grace period, as a fallback if the first
          // side's attempt never lands.
          if (localName < info.endpointName) {
            dial(endpointId)
          } else {
            main.postDelayed(
                {
                  if (running && discovered.containsKey(endpointId) && !connected.contains(endpointId)) {
                    dial(endpointId)
                  }
                },
                FALLBACK_DIAL_MS)
          }
        }

        override fun onEndpointLost(endpointId: String) {
          discovered.remove(endpointId)
        }
      }

  // ---- Radio on/off -------------------------------------------------------

  private fun startRadios() {
    val strategy = Strategy.P2P_CLUSTER
    client
        .startAdvertising(
            localName,
            SERVICE_ID,
            connectionLifecycle,
            AdvertisingOptions.Builder().setStrategy(strategy).build())
        .addOnFailureListener { emit("NearbyState", stateMap("error", it.message)) }
    client
        .startDiscovery(
            SERVICE_ID,
            discoveryCallback,
            DiscoveryOptions.Builder().setStrategy(strategy).build())
        .addOnFailureListener { emit("NearbyState", stateMap("error", it.message)) }
  }

  // ---- The phone's own radios ---------------------------------------------

  /** "wifi-off" / "bluetooth-off" while one of them is off on the phone, otherwise null. We never turn them on. */
  private fun radioOff(): String? {
    val wifi = reactContext.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    if (wifi != null && !wifi.isWifiEnabled) return "wifi-off"
    val bt = (reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
    if (bt != null && !bt.isEnabled) return "bluetooth-off"
    return null
  }

  /** Follow the person turning Wi-Fi or Bluetooth on or off. */
  private fun watchRadios() {
    if (radioReceiver != null) return
    val receiver =
        object : BroadcastReceiver() {
          override fun onReceive(context: Context?, intent: Intent?) {
            main.post { reevaluate() }
          }
        }
    val filter =
        IntentFilter().apply {
          addAction(WifiManager.WIFI_STATE_CHANGED_ACTION)
          addAction(BluetoothAdapter.ACTION_STATE_CHANGED)
        }
    ContextCompat.registerReceiver(reactContext, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
    radioReceiver = receiver
  }

  private fun unwatchRadios() {
    radioReceiver?.let {
      try {
        reactContext.unregisterReceiver(it)
      } catch (_: Exception) {}
    }
    radioReceiver = null
  }

  /** Run only while both radios are on: start when the person turns them on, let go when they turn one off. */
  private fun reevaluate() {
    if (!wanted) return
    val off = radioOff()
    if (off == null) {
      sawRadiosOn = true
      if (!running) {
        running = true
        allowPowerOn = false
        startRadios()
        emit("NearbyState", stateMap("active", null))
      }
    } else if (running && sawRadiosOn) {
      // The person turned Wi-Fi or Bluetooth off while we were using it: stop, and never power it back on by ourselves.
      pauseRadios()
      allowPowerOn = false
      sawRadiosOn = false
      emit("NearbyState", stateMap(off, null))
    } else if (!running) {
      emit("NearbyState", stateMap(off, null))
    }
  }

  /** Stop using the radios (links, advertising, discovery) but keep waiting for them to come back. */
  private fun pauseRadios() {
    running = false
    main.removeCallbacksAndMessages(null)
    try {
      client.stopAdvertising()
      client.stopDiscovery()
      client.stopAllEndpoints()
    } catch (_: Exception) {}
    connected.clear()
    connecting.clear()
    discovered.clear()
    endpointNames.clear()
    attempts.clear()
    emitEndpoints()
  }

  // ---- Wi-Fi watcher (for the app's mesh rules) ----------------------------

  private var wifiWatcher: BroadcastReceiver? = null

  private fun wifiOn(): Boolean {
    val wifi = reactContext.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    return wifi?.isWifiEnabled == true
  }

  /** Tell JS whenever the person turns the phone's Wi-Fi on or off. Resolves with the current state. */
  @ReactMethod
  fun watchWifi(promise: Promise) {
    try {
      if (wifiWatcher == null) {
        val receiver =
            object : BroadcastReceiver() {
              override fun onReceive(context: Context?, intent: Intent?) {
                val state = intent?.getIntExtra(WifiManager.EXTRA_WIFI_STATE, WifiManager.WIFI_STATE_UNKNOWN)
                if (state == WifiManager.WIFI_STATE_ENABLED || state == WifiManager.WIFI_STATE_DISABLED) {
                  val m = Arguments.createMap()
                  m.putBoolean("on", state == WifiManager.WIFI_STATE_ENABLED)
                  emit("WifiState", m)
                }
              }
            }
        ContextCompat.registerReceiver(
            reactContext, receiver, IntentFilter(WifiManager.WIFI_STATE_CHANGED_ACTION), ContextCompat.RECEIVER_NOT_EXPORTED)
        wifiWatcher = receiver
      }
      promise.resolve(wifiOn())
    } catch (e: Exception) {
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun isWifiOn(promise: Promise) {
    promise.resolve(wifiOn())
  }

  // ---- JS API -------------------------------------------------------------

  /**
   * Resolves true when the radio is running, false when it is waiting because Wi-Fi or Bluetooth is off. [allowPowerOn] is true only
   * right after the person switched the mesh on in the app: then Nearby may switch them on. Otherwise we only wait.
   */
  @ReactMethod
  fun start(name: String, allowPowerOn: Boolean, promise: Promise) {
    localName = if (name.isNotEmpty()) name else "pulse"
    try {
      wanted = true
      this.allowPowerOn = allowPowerOn
      watchRadios()
      val off = radioOff()
      sawRadiosOn = off == null
      if (off != null && !allowPowerOn) {
        // Pulse just opened with the mesh already on: wait, and do not touch Wi-Fi / Bluetooth.
        running = false
        emit("NearbyState", stateMap(off, null))
        promise.resolve(false)
        return
      }
      if (allowPowerOn) startBoost() // only when the person just switched the mesh on - never when Pulse merely opens
      running = true
      startRadios()
      emit("NearbyState", stateMap("active", null))
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("NEARBY_START_FAILED", e.message, e)
    }
  }

  /** A short (12 s) foreground service while the radio starts, as the old start-up had; it ends by itself. */
  private fun startBoost() {
    try {
      val i = Intent(reactContext, MeshForegroundService::class.java).putExtra("mode", "mesh")
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) reactContext.startForegroundService(i) else reactContext.startService(i)
    } catch (_: Exception) {}
  }

  /** Restart discovery + advertising WITHOUT dropping live connections. */
  @ReactMethod
  fun refresh(promise: Promise) {
    try {
      if (running && radioOff() != null) {
        reevaluate() // the person turned Wi-Fi or Bluetooth off meanwhile
      } else if (running) {
        client.stopDiscovery()
        client.stopAdvertising()
        discovered.clear()
        startRadios()
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("NEARBY_REFRESH_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      wanted = false
      allowPowerOn = false
      sawRadiosOn = false
      unwatchRadios()
      running = false
      main.removeCallbacksAndMessages(null)
      client.stopAdvertising()
      client.stopDiscovery()
      client.stopAllEndpoints()
      connected.clear()
      connecting.clear()
      discovered.clear()
      endpointNames.clear()
      attempts.clear()
      emitEndpoints()
      emit("NearbyState", stateMap("idle", null))
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("NEARBY_STOP_FAILED", e.message, e)
    }
  }

  /** Send to every connected peer, optionally skipping the one a relayed packet came from. */
  @ReactMethod
  fun send(wire: String, except: String?, promise: Promise) {
    try {
      val bytes = wire.toByteArray(StandardCharsets.UTF_8)
      if (bytes.size > MAX_BYTES) {
        promise.reject("NEARBY_TOO_LARGE", "frame is ${bytes.size} bytes (limit $MAX_BYTES)")
        return
      }
      val targets = connected.filter { it != except }
      if (targets.isNotEmpty()) {
        client.sendPayload(targets, Payload.fromBytes(bytes))
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("NEARBY_SEND_FAILED", e.message, e)
    }
  }

  /**
   * Used to start a permanent background service (and its "running in the background" notification). That is gone: the only
   * foreground service now runs during a voice call (see MeshForegroundService). Kept so older JavaScript calling it is harmless.
   */
  @ReactMethod
  fun startService(promise: Promise) {
    promise.resolve(true)
  }

  @ReactMethod
  fun stopService(promise: Promise) {
    try {
      reactContext.stopService(Intent(reactContext, MeshForegroundService::class.java))
      promise.resolve(true)
    } catch (e: Exception) {
      promise.resolve(false)
    }
  }

  // Required so JS NativeEventEmitter can attach without warnings.
  @ReactMethod fun addListener(eventName: String) {}

  @ReactMethod fun removeListeners(count: Int) {}

  companion object {
    private const val SERVICE_ID = "com.pulse.mesh"
    private const val MAX_BYTES = 32_000 // Nearby BYTES payloads cap at ~32 KB
    private const val MAX_ATTEMPTS = 6
    private const val RETRY_BASE_MS = 3_000L
    private const val FALLBACK_DIAL_MS = 12_000L
  }
}
