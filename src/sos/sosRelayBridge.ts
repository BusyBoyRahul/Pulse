import api from '@/services/apiService';
import {getJSON, setJSON} from '@/services/storage';
import type {MeshEngine} from '@/mesh/meshEngine';
import type {MeshPacket} from '@/types';

const QUEUE_KEY = 'sos.relayQueue';
const RETRY_MS = 20000;

type QueuedRelay = {
  packetId: string;
  origin: string;
  payload: string;
  originTimestamp: number;
};

/**
 * The bridge between the offline mesh and the internet.
 *
 * Every phone runs this. When it receives an SOS over BLE (or triggers its
 * own), the alert is queued locally. Whenever this phone has connectivity, the
 * queue is flushed to POST /sos/relay — which is where SMS + push fan-out
 * happens. This is what lets an alert "escape" the mesh through whichever
 * stranger's phone reaches signal first.
 */
class SosRelayBridge {
  private queue: QueuedRelay[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private unsub: (() => void) | null = null;

  attach(engine: MeshEngine): void {
    this.queue = getJSON<QueuedRelay[]>(QUEUE_KEY, []);
    // Relay any SOS this phone hears onto the internet when it can.
    this.unsub = engine.subscribe('SOS', (packet: MeshPacket) => {
      this.enqueue({
        packetId: packet.id,
        origin: packet.origin,
        payload: packet.payload,
        originTimestamp: packet.originTimestamp,
      });
    });
    if (!this.timer) {
      this.timer = setInterval(() => void this.flush(), RETRY_MS);
    }
    void this.flush();
  }

  detach(): void {
    this.unsub?.();
    this.unsub = null;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  enqueue(item: QueuedRelay): void {
    if (this.queue.some(q => q.packetId === item.packetId)) {
      return; // already pending
    }
    this.queue.push(item);
    this.persist();
    void this.flush();
  }

  get pending(): number {
    return this.queue.length;
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) {
      return;
    }
    this.flushing = true;
    try {
      const remaining: QueuedRelay[] = [];
      for (const item of this.queue) {
        try {
          const res = await api.post<{ok: boolean}>('/sos/relay', item);
          if (!res.ok) {
            remaining.push(item); // server reachable but not done — retry
          }
        } catch {
          // Offline — keep it and everything after; try again next cycle.
          remaining.push(item);
        }
      }
      this.queue = remaining;
      this.persist();
    } finally {
      this.flushing = false;
    }
  }

  private persist(): void {
    setJSON(QUEUE_KEY, this.queue);
  }
}

export const sosRelayBridge = new SosRelayBridge();
export default sosRelayBridge;
