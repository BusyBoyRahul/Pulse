import type {NearbyDevice} from '@/types';
import type {MeshTransport, TransportState} from './types';

/**
 * An in-memory transport used for tests and simulation. Multiple
 * LoopbackTransports sharing the same `bus` behave like phones in range of
 * each other, so a multi-hop mesh can be exercised without any radio.
 */
export class LoopbackBus {
  private nodes = new Set<LoopbackTransport>();

  join(node: LoopbackTransport) {
    this.nodes.add(node);
    this.broadcastDevices();
  }

  leave(node: LoopbackTransport) {
    this.nodes.delete(node);
    this.broadcastDevices();
  }

  send(from: LoopbackTransport, wire: string) {
    for (const node of this.nodes) {
      if (node !== from) {
        node.deliver(wire, from.id);
      }
    }
  }

  private broadcastDevices() {
    for (const node of this.nodes) {
      const peers: NearbyDevice[] = [...this.nodes]
        .filter(n => n !== node)
        .map(n => ({deviceId: n.id, rssi: -50, lastSeen: 0}));
      node.setDevices(peers);
    }
  }
}

let counter = 0;

export class LoopbackTransport implements MeshTransport {
  readonly id: string;
  state: TransportState = 'idle';
  private wireHandlers = new Set<(w: string, from: string) => void>();
  private deviceHandlers = new Set<(d: NearbyDevice[]) => void>();
  private stateHandlers = new Set<(s: TransportState) => void>();

  constructor(private bus: LoopbackBus, id?: string) {
    this.id = id ?? `loop-${counter++}`;
  }

  async start() {
    this.setState('active');
    this.bus.join(this);
  }

  async stop() {
    this.bus.leave(this);
    this.setState('idle');
  }

  async broadcast(wire: string) {
    this.bus.send(this, wire);
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

  // --- called by the bus ---
  deliver(wire: string, from: string) {
    this.wireHandlers.forEach(h => h(wire, from));
  }

  setDevices(devices: NearbyDevice[]) {
    this.deviceHandlers.forEach(h => h(devices));
  }

  private setState(s: TransportState) {
    this.state = s;
    this.stateHandlers.forEach(h => h(s));
  }
}
