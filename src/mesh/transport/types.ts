import type {NearbyDevice} from '@/types';

/**
 * A MeshTransport moves opaque wire strings between this device and its BLE
 * neighbours. It knows nothing about packet semantics (TTL, dedup, encryption)
 * — that all lives in the MeshEngine above it. This separation is what makes
 * the relay logic testable without a radio.
 */
export interface MeshTransport {
  /** Begin advertising + scanning. Resolves once the radio is active. */
  start(): Promise<void>;

  /** Stop all radio activity. */
  stop(): Promise<void>;

  /**
   * Broadcast a wire string to all reachable neighbours. `exceptDeviceId` skips
   * the neighbour a relayed packet just arrived from (no pointless echo).
   */
  broadcast(wire: string, exceptDeviceId?: string): Promise<void>;

  /** Register a handler for inbound wire strings. Returns an unsubscribe fn. */
  onWire(handler: (wire: string, from: string) => void): () => void;

  /** Register a handler for the changing set of nearby devices. */
  onDevices(handler: (devices: NearbyDevice[]) => void): () => void;

  /** Current radio/adapter state. */
  readonly state: TransportState;
  onStateChange(handler: (state: TransportState) => void): () => void;
}

export type TransportState =
  | 'idle'
  | 'starting'
  | 'active'
  | 'bluetooth-off'
  | 'unauthorized'
  | 'unsupported'
  | 'error';

/**
 * The peripheral (advertising / GATT-server) side of BLE, which react-native-
 * ble-plx does NOT provide. Injected into BleMeshTransport so production can
 * wire a real advertiser (react-native-ble-advertiser) while tests/dev use a
 * no-op. See docs/NATIVE_SETUP.md.
 */
export interface PeripheralAdapter {
  startAdvertising(serviceUUID: string, payload: string): Promise<void>;
  updatePayload(payload: string): Promise<void>;
  stopAdvertising(): Promise<void>;
  readonly supported: boolean;
}
