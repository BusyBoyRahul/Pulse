import {PermissionsAndroid, Platform} from 'react-native';

/**
 * Contextual permission requests. Each is asked separately, after an in-app
 * explanation screen — never all at once. iOS BLE/location prompts are driven
 * by the native libraries on first use; this module owns the Android runtime
 * requests and exposes a uniform result shape.
 */
export type PermissionResult = 'granted' | 'denied' | 'blocked' | 'unavailable';

function normalize(status: string): PermissionResult {
  switch (status) {
    case PermissionsAndroid.RESULTS.GRANTED:
      return 'granted';
    case PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN:
      return 'blocked';
    default:
      return 'denied';
  }
}

async function requestMany(perms: string[]): Promise<PermissionResult> {
  const valid = perms.filter(p => !!(PermissionsAndroid.PERMISSIONS as Record<string, string>)[keyOf(p)]);
  const toRequest = valid.length ? valid : perms;
  const res = await PermissionsAndroid.requestMultiple(toRequest as never);
  const statuses = Object.values(res);
  if (statuses.every(s => s === PermissionsAndroid.RESULTS.GRANTED)) {
    return 'granted';
  }
  if (statuses.some(s => s === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN)) {
    return 'blocked';
  }
  return 'denied';
}

// Map a permission string back to its PERMISSIONS key (best-effort guard).
function keyOf(perm: string): string {
  return perm.split('.').pop() ?? perm;
}

export async function requestNotifications(): Promise<PermissionResult> {
  if (Platform.OS !== 'android') {
    return 'granted'; // iOS handled by push registration
  }
  if (Platform.Version < 33) {
    return 'granted'; // POST_NOTIFICATIONS only exists on Android 13+
  }
  const status = await PermissionsAndroid.request(
    'android.permission.POST_NOTIFICATIONS' as never,
  );
  return normalize(status);
}

export async function requestBluetooth(): Promise<PermissionResult> {
  if (Platform.OS !== 'android') {
    return 'granted'; // iOS prompts on first BleManager use
  }
  if (Platform.Version >= 31) {
    return requestMany([
      'android.permission.BLUETOOTH_SCAN',
      'android.permission.BLUETOOTH_ADVERTISE',
      'android.permission.BLUETOOTH_CONNECT',
    ]);
  }
  // Pre-Android 12, BLE scanning is gated behind fine location.
  return requestLocation();
}

/**
 * Everything Nearby Connections needs to discover + connect to peers offline:
 * Bluetooth (12+), Wi-Fi nearby devices (13+), and location (older Androids gate
 * peer discovery behind it). Safe to call repeatedly — the OS only prompts for
 * what isn't granted. Called at startup so already-onboarded users are covered.
 */
export async function requestMeshPermissions(): Promise<PermissionResult> {
  if (Platform.OS !== 'android') {
    return 'granted';
  }
  const perms: string[] = [];
  if (Platform.Version >= 31) {
    perms.push(
      'android.permission.BLUETOOTH_SCAN',
      'android.permission.BLUETOOTH_ADVERTISE',
      'android.permission.BLUETOOTH_CONNECT',
    );
  }
  if (Platform.Version >= 33) {
    perms.push('android.permission.NEARBY_WIFI_DEVICES');
  }
  // Older Androids (and Wi-Fi discovery) still gate peer scanning behind location.
  perms.push('android.permission.ACCESS_FINE_LOCATION');
  // Android 13+: the 'Pulse mesh is on' notice and incoming-call alerts need this.
  if (Platform.Version >= 33) {
    perms.push('android.permission.POST_NOTIFICATIONS');
  }

  // Request the raw permission strings directly — do NOT route through the
  // key-filtering helper, which can silently drop NEARBY_WIFI_DEVICES on RN
  // versions whose PERMISSIONS map lacks that constant.
  const res = await PermissionsAndroid.requestMultiple(perms as never);
  const statuses = Object.values(res);
  if (statuses.every(s => s === PermissionsAndroid.RESULTS.GRANTED)) {
    return 'granted';
  }
  if (statuses.some(s => s === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN)) {
    return 'blocked';
  }
  return 'denied';
}

export async function requestLocation(): Promise<PermissionResult> {
  if (Platform.OS !== 'android') {
    return 'granted';
  }
  const status = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  );
  return normalize(status);
}

/** SEND_SMS — so an SOS can text contacts from the SIM (Android only). */
export async function requestSms(): Promise<PermissionResult> {
  if (Platform.OS !== 'android') {
    return 'unavailable';
  }
  const status = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.SEND_SMS);
  return normalize(status);
}

/** RECORD_AUDIO — needed to place or answer an in-app voice call. */
export async function requestMicrophone(): Promise<PermissionResult> {
  if (Platform.OS !== 'android') {
    return 'granted';
  }
  const status = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  return normalize(status);
}
