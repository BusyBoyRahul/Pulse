import {NativeEventEmitter, NativeModules} from 'react-native';

import type {NearbyDevice} from '@/types';
import {getIdentity} from '@/services/identity';
import type {MeshTransport, TransportState} from './types';
import {radioWanted, onRadioWishChange, setRadioState, takePowerOnGrant} from '../radioGate';

type NativeNearby = {
  start(name: string, allowPowerOn: boolean): Promise<boolean>;
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

  private radioOn = false;
  private offWish: (() => void) | null = null;
  private chain: Promise<void> = Promise.resolve();

  /**
   * Starting this transport only gets it ready. The radio itself (Bluetooth / Wi-Fi) runs ONLY while the person has the mesh
   * switched on (or just sent an SOS). Wi-Fi / Bluetooth are switched on only as a result of the person switching the mesh on
   * (or SOS); starting with them off (Pulse just opened) only waits.
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    if (!Nearby) {
      this.setState('unsupported');
      setRadioState('unsupported');
      return;
    }
    this.running = true;

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
        if (!this.radioOn) {
          return;
        }
        if (e.state === 'active') {
          this.setState('active');
          setRadioState('on');
        } else if (e.state === 'idle') {
          this.setState('idle');
        } else if (e.state === 'wifi-off' || e.state === 'bluetooth-off') {
          this.setState(e.state === 'bluetooth-off' ? 'bluetooth-off' : 'wifi-off');
          setRadioState(e.state);
        } else if (e.state === 'error') {
          this.setState('error');
          setRadioState('error');
        }
      }),
    );

    this.offWish = onRadioWishChange(() => this.apply());
    await this.apply();
  }

  /** Bring the radio on or off to match what the person wants. One change at a time. */
  private apply(): Promise<void> {
    this.chain = this.chain.then(async () => {
      if (!this.running || !Nearby) {
        return;
      }
      const want = radioWanted();
      const grant = takePowerOnGrant(); // true only right after the person switched the mesh on (or pressed SOS)
      if (want && !this.radioOn) {
        this.radioOn = true;
        this.setState('starting');
        setRadioState('starting');
        // Advertise ourselves under our mesh public key so peers can map us.
        const name = getIdentity().publicKey.slice(0, 40);
        try {
          const started = await Nearby.start(name, grant);
          if (started) {
            this.setState('active');
            setRadioState('on');
          } // else: Wi-Fi or Bluetooth is off and was not allowed to be switched on - waits until the person turns them on.
          this.refreshTimer = setInterval(() => {
            void Nearby.refresh().catch(() => undefined);
          }, REFRESH_MS);
        } catch {
          this.setState('error');
          setRadioState('error');
        }
      } else if (!want && this.radioOn) {
        this.radioOn = false;
        if (this.refreshTimer) {
          clearInterval(this.refreshTimer);
          this.refreshTimer = null;
        }
        this.devices.clear();
        this.emitDevices();
        try {
          await Nearby.stop();
        } catch {
          /* ignore */
        }
        this.setState('idle');
        setRadioState('off');
      }
    });
    return this.chain;
  }

  async stop(): Promise<void> {
    this.running = false;
    this.offWish?.();
    this.offWish = null;
    this.radioOn = false;
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
    } catch {
      /* ignore */
    }
    this.setState('idle');
    setRadioState('off');
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
