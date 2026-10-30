/**
 * Runtime configuration. In a real build these come from a .env via
 * react-native-config; kept centralized so there is one place to point the
 * app at dev vs. production infrastructure.
 */
import {Platform} from 'react-native';

// Android emulator reaches host machine via 10.0.2.2; iOS sim uses localhost.
const devHost = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';

export const config = {
  apiBaseUrl: __DEV__ ? `http://${devHost}:4000` : 'https://api.pulse.app',

  // BLE service that identifies a Pulse node. Any device advertising this UUID
  // is a relay candidate. (Randomly generated for this project.)
  meshServiceUUID: 'b1f9c0de-7a42-4c8e-9f21-3d5e6a7b8c90',
  meshCharacteristicUUID: 'b1f9c0de-7a42-4c8e-9f21-3d5e6a7b8c91',

  // Server's public sealing key (Curve25519, base64). SOS payloads are sealed
  // to this so relay phones forward them without reading the location. The
  // matching secret lives only on the server (SERVER_SEAL_SECRET). Dev key —
  // regenerate the pair for production.
  serverPublicKey: 'bIlyAH2kjGQQd/sFW5IcATCEkWvuz37jU5nGqqiIFHc=',

  // Relay behavior
  defaultTtl: 6, // max hops a packet travels
  scanWindowMs: 5000,
  scanIntervalMs: 30000, // duty-cycled scanning to protect battery
  seenCacheSize: 4096, // de-dup ring buffer size (photo chunks + presence churn through it fast)

  // Store-and-forward: a relay phone carries packets for people it can't reach
  // YET and hands them over when they come into range.
  carryMax: 120, // packets held
  carryMaxChars: 3_000_000, // total wire size held (memory guard)
  carryDirectMs: 12 * 60 * 60 * 1000, // directed messages are carried this long
  carryBroadcastMs: 45 * 60 * 1000, // SOS / notes / group traffic
  carryFlushGapMs: 8000, // min gap between carry hand-overs

  // SOS
  sosHoldMs: 3000, // press-and-hold duration to arm
  sosCancelWindowMs: 5000, // grace period to abort a false alarm

  // Safety notes
  noteTtlDays: 30,
} as const;

export type AppConfig = typeof config;
export default config;
