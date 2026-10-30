import {BleManager, Device, State, Subscription} from 'react-native-ble-plx';
import naclUtil from 'tweetnacl-util';

import config from '@/config';
import type {NearbyDevice} from '@/types';
import type {MeshTransport, PeripheralAdapter, TransportState} from './types';
import {NoopPeripheralAdapter} from './NoopPeripheralAdapter';

/**
 * Real BLE transport built on react-native-ble-plx (central role) plus an
 * injected PeripheralAdapter (advertising role — see types.ts).
 *
 * Central responsibilities handled here:
 *   - duty-cycled scanning for Pulse nodes (battery-aware: scan N ms every M ms)
 *   - tracking the live set of nearby devices
 *   - connecting to peers and writing wire strings to the mesh characteristic
 *   - monitoring that characteristic for inbound wire strings
 */
export class BleMeshTransport implements MeshTransport {
  state: TransportState = 'idle';

  private manager: BleManager;
  private peripheral: PeripheralAdapter;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  private devices = new Map<string, NearbyDevice>();
  private connections = new Map<string, Device>();
  private monitors = new Map<string, Subscription>();

  private wireHandlers = new Set<(w: string, from: string) => void>();
  private deviceHandlers = new Set<(d: NearbyDevice[]) => void>();
  private stateHandlers = new Set<(s: TransportState) => void>();

  constructor(peripheral: PeripheralAdapter = new NoopPeripheralAdapter()) {
    this.manager = new BleManager();
    this.peripheral = peripheral;
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    this.setState('starting');

    const state = await this.manager.state();
    if (!this.applyAdapterState(state)) {
      return; // radio not usable yet; onStateChange will retry
    }

    this.manager.onStateChange(s => {
      if (this.applyAdapterState(s) && this.running) {
        this.beginRadio();
      }
    }, false);

    await this.beginRadio();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    this.manager.stopDeviceScan();
    this.monitors.forEach(m => m.remove());
    this.monitors.clear();
    for (const id of this.connections.keys()) {
      try {
        await this.manager.cancelDeviceConnection(id);
      } catch {
        /* already gone */
      }
    }
    this.connections.clear();
    await this.peripheral.stopAdvertising();
    this.setState('idle');
  }

  async broadcast(wire: string): Promise<void> {
    const value = naclUtil.encodeBase64(naclUtil.decodeUTF8(wire));
    // Keep our advertised payload fresh (small packets can ride the beacon).
    await this.peripheral.updatePayload(wire).catch(() => {});
    // Fan out to every currently-connected peer.
    await Promise.all(
      [...this.connections.keys()].map(id =>
        this.manager
          .writeCharacteristicWithoutResponseForDevice(
            id,
            config.meshServiceUUID,
            config.meshCharacteristicUUID,
            value,
          )
          .catch(() => this.dropConnection(id)),
      ),
    );
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

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async beginRadio(): Promise<void> {
    await this.peripheral.startAdvertising(config.meshServiceUUID, '').catch(() => {});
    this.setState('active');
    this.scanCycle();
  }

  /** Duty-cycled scan: scan for scanWindowMs, rest for scanIntervalMs. */
  private scanCycle = () => {
    if (!this.running) {
      return;
    }
    this.manager.startDeviceScan(
      [config.meshServiceUUID],
      {allowDuplicates: false},
      (error, device) => {
        if (error || !device) {
          return;
        }
        this.observeDevice(device);
      },
    );

    this.scanTimer = setTimeout(() => {
      this.manager.stopDeviceScan();
      this.pruneStaleDevices();
      // Rest, then scan again — this is the primary battery lever.
      this.scanTimer = setTimeout(this.scanCycle, config.scanIntervalMs);
    }, config.scanWindowMs);
  };

  private observeDevice(device: Device) {
    const existing = this.devices.get(device.id);
    this.devices.set(device.id, {
      deviceId: device.id,
      rssi: device.rssi ?? existing?.rssi ?? null,
      lastSeen: Date.now(),
    });
    this.emitDevices();
    if (!this.connections.has(device.id)) {
      void this.connectAndMonitor(device);
    }
  }

  private async connectAndMonitor(device: Device) {
    try {
      const connected = await this.manager.connectToDevice(device.id, {timeout: 8000});
      await connected.discoverAllServicesAndCharacteristics();
      this.connections.set(device.id, connected);

      connected.onDisconnected(() => this.dropConnection(device.id));

      const sub = this.manager.monitorCharacteristicForDevice(
        device.id,
        config.meshServiceUUID,
        config.meshCharacteristicUUID,
        (error, characteristic) => {
          if (error || !characteristic?.value) {
            return;
          }
          try {
            const wire = naclUtil.encodeUTF8(naclUtil.decodeBase64(characteristic.value));
            this.wireHandlers.forEach(h => h(wire, device.id));
          } catch {
            /* malformed frame; ignore */
          }
        },
      );
      this.monitors.set(device.id, sub);
    } catch {
      this.dropConnection(device.id);
    }
  }

  private dropConnection(id: string) {
    this.monitors.get(id)?.remove();
    this.monitors.delete(id);
    this.connections.delete(id);
  }

  private pruneStaleDevices() {
    const cutoff = Date.now() - config.scanIntervalMs * 3;
    let changed = false;
    for (const [id, dev] of this.devices) {
      if (dev.lastSeen < cutoff) {
        this.devices.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.emitDevices();
    }
  }

  private emitDevices() {
    const list = [...this.devices.values()].sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
    this.deviceHandlers.forEach(h => h(list));
  }

  /** Map ble-plx adapter state to our transport state. Returns true if usable. */
  private applyAdapterState(s: State): boolean {
    switch (s) {
      case State.PoweredOn:
        return true;
      case State.PoweredOff:
        this.setState('bluetooth-off');
        return false;
      case State.Unauthorized:
        this.setState('unauthorized');
        return false;
      case State.Unsupported:
        this.setState('unsupported');
        return false;
      default:
        return false;
    }
  }

  private setState(s: TransportState) {
    this.state = s;
    this.stateHandlers.forEach(h => h(s));
  }
}
