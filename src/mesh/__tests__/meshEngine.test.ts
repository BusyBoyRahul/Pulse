import {MeshEngine} from '../meshEngine';
import type {MeshTransport, TransportState} from '../transport/types';
import type {MeshPacket, NearbyDevice} from '@/types';

/**
 * A topology-aware in-memory transport. Unlike the full-mesh LoopbackBus, this
 * only delivers a broadcast to a node's declared neighbours, so we can model a
 * real chain (A—B—C—D) where A and D are NOT in Bluetooth range and a message
 * must physically hop to arrive.
 */
class TopologyBus {
  private nodes = new Map<string, TopologyTransport>();
  private adj = new Map<string, Set<string>>();

  link(a: string, b: string) {
    (this.adj.get(a) ?? this.set(a)).add(b);
    (this.adj.get(b) ?? this.set(b)).add(a);
  }
  private set(id: string) {
    const s = new Set<string>();
    this.adj.set(id, s);
    return s;
  }
  register(t: TopologyTransport) {
    this.nodes.set(t.id, t);
  }
  deliver(from: string, wire: string) {
    for (const neighbour of this.adj.get(from) ?? []) {
      this.nodes.get(neighbour)?.receive(wire, from);
    }
  }
}

class TopologyTransport implements MeshTransport {
  state: TransportState = 'active';
  private wireHandlers = new Set<(w: string, from: string) => void>();
  constructor(readonly id: string, private bus: TopologyBus) {
    bus.register(this);
  }
  async start() {}
  async stop() {}
  async broadcast(wire: string) {
    // async delivery to mimic radio (still deterministic within a microtask)
    this.bus.deliver(this.id, wire);
  }
  onWire(h: (w: string, from: string) => void) {
    this.wireHandlers.add(h);
    return () => this.wireHandlers.delete(h);
  }
  onDevices(_h: (d: NearbyDevice[]) => void) {
    return () => {};
  }
  onStateChange(_h: (s: TransportState) => void) {
    return () => {};
  }
  receive(wire: string, from: string) {
    this.wireHandlers.forEach(h => h(wire, from));
  }
}

async function flush() {
  // let queued microtask broadcasts settle
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe('MeshEngine — multi-hop relay over a chain', () => {
  it('delivers an SOS from A to D across intermediate hops', async () => {
    const bus = new TopologyBus();
    bus.link('A', 'B');
    bus.link('B', 'C');
    bus.link('C', 'D');

    const engines = ['A', 'B', 'C', 'D'].map(
      id => new MeshEngine(new TopologyTransport(id, bus), id),
    );
    await Promise.all(engines.map(e => e.start()));

    const received: MeshPacket[] = [];
    engines[3].subscribe('SOS', p => received.push(p)); // D listens

    await engines[0].send({type: 'SOS', payload: 'help'}); // A sends
    await flush();

    expect(received).toHaveLength(1);
    expect(received[0].payload).toBe('help');
    // Origin sends full ttl=6; B relays->5, C relays->4; D receives at ttl 4.
    expect(received[0].ttl).toBe(4);
  });

  it('stops relaying once ttl is exhausted', async () => {
    const bus = new TopologyBus();
    bus.link('A', 'B');
    bus.link('B', 'C');
    bus.link('C', 'D');
    const engines = ['A', 'B', 'C', 'D'].map(
      id => new MeshEngine(new TopologyTransport(id, bus), id),
    );
    await Promise.all(engines.map(e => e.start()));

    const gotC: MeshPacket[] = [];
    const gotD: MeshPacket[] = [];
    engines[2].subscribe('CHAT', p => gotC.push(p));
    engines[3].subscribe('CHAT', p => gotD.push(p));

    // ttl 1: A->B receives(1) relays ttl0 -> C receives(0) but ttl exhausted,
    // so C never relays to D. The packet dies at C.
    await engines[0].send({type: 'CHAT', payload: 'hi', ttl: 1});
    await flush();

    expect(gotC).toHaveLength(1); // reached C
    expect(gotD).toHaveLength(0); // never made the final hop
  });

  it('does not loop forever in a cyclic topology (dedup holds)', async () => {
    const bus = new TopologyBus();
    // triangle: everyone hears everyone -> lots of relay opportunities
    bus.link('A', 'B');
    bus.link('B', 'C');
    bus.link('C', 'A');
    const engines = ['A', 'B', 'C'].map(
      id => new MeshEngine(new TopologyTransport(id, bus), id),
    );
    await Promise.all(engines.map(e => e.start()));

    const counts: Record<string, number> = {B: 0, C: 0};
    engines[1].subscribe('NOTE', () => (counts.B += 1));
    engines[2].subscribe('NOTE', () => (counts.C += 1));

    await engines[0].send({type: 'NOTE', payload: 'note'});
    await flush();

    // Each node delivers the note to its subscriber exactly once.
    expect(counts.B).toBe(1);
    expect(counts.C).toBe(1);
  });

  it('routes a directed message only to its recipient subscriber', async () => {
    const bus = new TopologyBus();
    bus.link('A', 'B');
    bus.link('B', 'C');
    const engines = ['A', 'B', 'C'].map(
      id => new MeshEngine(new TopologyTransport(id, bus), id),
    );
    await Promise.all(engines.map(e => e.start()));

    const gotB: MeshPacket[] = [];
    const gotC: MeshPacket[] = [];
    engines[1].subscribe('CHAT', p => gotB.push(p));
    engines[2].subscribe('CHAT', p => gotC.push(p));

    await engines[0].send({type: 'CHAT', payload: 'for-C', recipient: 'C'});
    await flush();

    expect(gotC).toHaveLength(1); // C is the recipient
    expect(gotB).toHaveLength(0); // B relays but does not "deliver" to its app
  });
});
