import {NativeEventEmitter, NativeModules} from 'react-native';

import type {NearbyDevice} from '@/types';
import {getIdentity} from '@/services/identity';
import type {MeshTransport, TransportState} from './types';

type NativeNearby = {
  start(name: string): Promise<boolean>;
  stop(): Promise<boolean>;
  refresh(): Promise<boolean>;
  send(wire: string, except: string | null): Promise<boolean>;
  startService(): Promise<boolean>;
  stopService(): Promise<boolean>;
  addListener(event: string): void;
  removeListeners(count: number): void;
};

const Nearby = NativeModules.NearbyMesh as NativeNearby | undefined;

// Long-running Nearby discovery can go stale on some phones; kick it gently.
const REFRESH_MS = 120000;

/**
 * MeshTransport backed by the native Nearby Connections module. Every phone
 * advertises + discovers under one service id and auto-connects to peers over
 * Bluetooth / Wi-Fi — fully offline, no server. Moves opaque wire strings; all
 * packet semantics live in the MeshEngine above.
 */
export class NearbyMeshTransport implements MeshTransport {
  state: TransportState = 'idle';

  private emitter: NativeEventEmitter | null = null;
  private subs: {remove: () => void}[] = [];
  private running = false;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  private devices = new Map<string, NearbyDevice>();
  private wireHandlers = new Set<(w: string, from: string) => void>();
  private deviceHandlers = new Set<(d: NearbyDevice[]) => void>();
  private stateHandlers = new Set<(s: TransportState) => void>();

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    if (!Nearby) {
      this.setState('unsupported');
      return;
    }
    this.running = true;
    this.setState('starting');

    this.emitter = new NativeEventEmitter(NativeModules.NearbyMesh);
    this.subs.push(
      this.emitter.addListener('NearbyPayload', (e: {wire: string; from: string}) => {
        this.wireHandlers.forEach(h => h(e.wire, e.from));
      }),
    );
    this.subs.push(
      this.emitter.addListener('NearbyEndpoints', (list: {deviceId: string; name: string}[]) => {
        this.devices.clear();
        const now = Date.now();
        for (const ep of list) {
          this.devices.set(ep.deviceId, {
            deviceId: ep.deviceId,
            publicKey: ep.name || undefined,
            rssi: null,
            lastSeen: now,
          });
        }
        this.emitDevices();
      }),
    );
    this.subs.push(
      this.emitter.addListener('NearbyState', (e: {state: string; error?: string}) => {
        if (e.state === 'active') {
          this.setState('active');
        } else if (e.state === 'idle') {
          this.setState('idle');
        } else if (e.state === 'error') {
          this.setState('error');
        }
      }),
    );

    // Advertise ourselves under our mesh public key so peers can map us.
    const name = getIdentity().publicKey.slice(0, 40);
    try {
      await Nearby.start(name);
      this.setState('active');
      // Keep the process alive with the screen off so this phone keeps relaying.
      void Nearby.startService().catch(() => undefined);
      this.refreshTimer = setInterval(() => {
        void Nearby.refresh().catch(() => undefined);
      }, REFRESH_MS);
    } catch {
      this.setState('error');
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.subs.forEach(s => s.remove());
    this.subs = [];
    this.devices.clear();
    this.emitDevices();
    try {
      await Nearby?.stop();
      await Nearby?.stopService();
    } catch {
      /* ignore */
    }
    this.setState('idle');
  }

  async broadcast(wire: string, exceptDeviceId?: string): Promise<void> {
    try {
      await Nearby?.send(wire, exceptDeviceId ?? null);
    } catch {
      /* peers may have dropped; roster refresh will correct */
    }
  }

  onWire(handler: (w: string, from: string) => void) {
    this.wireHandlers.add(handler);
    return () => this.wireHandlers.delete(handler);
  }

  onDevices(handler: (d: NearbyDevice[]) => void) {
    this.deviceHandlers.add(handler);
    return () => this.deviceHandlers.delete(handler);
  }

  onStateChange(handler: (s: TransportState) => void) {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  private emitDevices() {
    const list = [...this.devices.values()];
    this.deviceHandlers.forEach(h => h(list));
  }

  private setState(s: TransportState) {
    this.state = s;
    this.stateHandlers.forEach(h => h(s));
  }
}
