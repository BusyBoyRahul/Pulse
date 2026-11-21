import type {NearbyDevice} from '@/types';
import type {MeshTransport, TransportState} from './types';

/**
 * Several ways of reaching people at once (for example Bluetooth/Wi-Fi AND the
 * internet). The mesh engine talks to this as if it were one transport:
 * everything sent goes out on every road, everything that arrives from any road
 * comes in. Duplicates (the same packet on two roads) are removed by the engine.
 */
export class MultiTransport implements MeshTransport {
  private stateHandlers = new Set<(s: TransportState) => void>();

  constructor(private parts: MeshTransport[]) {
    parts.forEach(p => p.onStateChange(() => this.emit()));
  }

  private emit() {
    const s = this.state;
    this.stateHandlers.forEach(h => h(s));
  }

  /** Best of the parts: active if any road works; otherwise the first road's problem. */
  get state(): TransportState {
    if (this.parts.some(p => p.state === 'active')) {
      return 'active';
    }
    return this.parts[0]?.state ?? 'idle';
  }

  async start(): Promise<void> {
    const results = await Promise.allSettled(this.parts.map(p => p.start()));
    if (results.every(r => r.status === 'rejected')) {
      throw (results[0] as PromiseRejectedResult).reason;
    }
  }

  async stop(): Promise<void> {
    await Promise.allSettled(this.parts.map(p => p.stop()));
  }

  async broadcast(wire: string, exceptDeviceId?: string): Promise<void> {
    await Promise.allSettled(this.parts.map(p => p.broadcast(wire, exceptDeviceId)));
  }

  onWire(handler: (wire: string, from: string) => void): () => void {
    const offs = this.parts.map(p => p.onWire(handler));
    return () => offs.forEach(o => o());
  }

  onDevices(handler: (devices: NearbyDevice[]) => void): () => void {
    const latest = new Map<number, NearbyDevice[]>();
    const offs = this.parts.map((p, i) =>
      p.onDevices(d => {
        latest.set(i, d);
        handler([...latest.values()].flat());
      }),
    );
    return () => offs.forEach(o => o());
  }

  onStateChange(handler: (s: TransportState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }
}
