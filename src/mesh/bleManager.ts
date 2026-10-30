import {Platform} from 'react-native';

import {MeshEngine} from './meshEngine';
import {NearbyMeshTransport} from './transport/NearbyMeshTransport';
import {BleMeshTransport} from './transport/BleMeshTransport';
import type {MeshTransport} from './transport/types';
import {getIdentity} from '@/services/identity';

/**
 * Assembles the production mesh: an offline peer-to-peer transport + relay
 * engine, keyed to this device's identity. Kept as a lazily-created singleton so
 * the whole app shares one radio and one seen-cache.
 *
 * Android uses Nearby Connections (real Bluetooth + Wi-Fi peer discovery). The
 * legacy BLE transport is kept as a fallback for platforms without Nearby.
 *
 * Tests build their own MeshEngine with a LoopbackTransport instead.
 */
let engine: MeshEngine | null = null;

function defaultTransport(): MeshTransport {
  return Platform.OS === 'android' ? new NearbyMeshTransport() : new BleMeshTransport();
}

export function getMeshEngine(transport?: MeshTransport): MeshEngine {
  if (!engine) {
    const selfKey = getIdentity().publicKey;
    engine = new MeshEngine(transport ?? defaultTransport(), selfKey);
  }
  return engine;
}

export function resetMeshEngine() {
  engine = null;
}
