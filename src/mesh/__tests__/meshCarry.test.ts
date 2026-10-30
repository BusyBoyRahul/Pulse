import {MeshEngine} from '../meshEngine';
import type {MeshTransport, TransportState} from '../transport/types';
import type {MeshPacket, NearbyDevice} from '@/types';

/**
 * A dynamic topology: phones can walk into / out of range of each other while
 * the test runs. Every link change reports the new neighbour list, exactly as
 * the Nearby transport does on a real phone.
 */
class DynamicBus {
  nodes = new Map<string, DynamicTransport>();
  adj = new Map<string, Set<string>>();
  sent: {from: string; except?: string}[] = [];

  add(id: string) {
    const t = new DynamicTransport(id, this);
    this.nodes.set(id, t);
    this.adj.set(id, new Set());
    return t;
  }
  link(a: string, b: string) {
    this.adj.get(a)!.add(b);
    this.adj.get(b)!.add(a);
    this.nodes.get(a)!.neighboursChanged();
    this.nodes.get(b)!.neighboursChanged();
  }
  unlink(a: string, b: string) {
    this.adj.get(a)!.delete(b);
    this.adj.get(b)!.delete(a);
    this.nodes.get(a)!.neighboursChanged();
    this.nodes.get(b)!.neighboursChanged();
  }
  deliver(from: string, wire: string, except?: string) {
    this.sent.push({from, except});
    for (const n of this.adj.get(from) ?? []) {
      if (n !== except) {
        this.nodes.get(n)?.receive(wire, from);
      }
    }
  }
}

class DynamicTransport implements MeshTransport {
  state: TransportState = 'active';
  private wire = new Set<(w: string, from: string) => void>();
  private dev = new Set<(d: NearbyDevice[]) => void>();
  constructor(readonly id: string, private bus: DynamicBus) {}
  async start() {}
  async stop() {}
  async broadcast(wire: string, except?: string) {
    this.bus.deliver(this.id, wire, except);
  }
  onWire(h: (w: string, from: string) => void) {
    this.wire.add(h);
    return () => this.wire.delete(h);
  }
  onDevices(h: (d: NearbyDevice[]) => void) {
    this.dev.add(h);
    return () => this.dev.delete(h);
  }
  onStateChange() {
    return () => {};
  }
  receive(w: string, from: string) {
    this.wire.forEach(h => h(w, from));
  }
  neighboursChanged() {
    const list = [...(this.bus.adj.get(this.id) ?? [])].map(id => ({deviceId: id, rssi: null, lastSeen: 0}));
    this.dev.forEach(h => h(list));
  }
}

const tick = (ms: number) => jest.advanceTimersByTimeAsync(ms);

describe('A → B → C when A and C are never in range of each other', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('delivers a directed message through the middle phone', async () => {
    const bus = new DynamicBus();
    const engines = ['A', 'B', 'C'].map(id => new MeshEngine(bus.add(id), id));
    await Promise.all(engines.map(e => e.start()));
    bus.link('A', 'B');
    bus.link('B', 'C');

    const gotC: MeshPacket[] = [];
    const gotB: MeshPacket[] = [];
    engines[2].subscribe('CHAT', p => gotC.push(p));
    engines[1].subscribe('CHAT', p => gotB.push(p));

    await engines[0].send({type: 'CHAT', payload: 'secret', recipient: 'C', nonce: 'n'});
    await tick(10);

    expect(gotC).toHaveLength(1);
    expect(gotC[0].payload).toBe('secret');
    expect(gotC[0].hops).toBe(1); // exactly one relay (B) in between
    expect(gotB).toHaveLength(0); // B forwards but never delivers it to its own app
  });

  it('counts hops across a longer chain', async () => {
    const bus = new DynamicBus();
    const ids = ['A', 'B', 'C', 'D'];
    const engines = ids.map(id => new MeshEngine(bus.add(id), id));
    await Promise.all(engines.map(e => e.start()));
    bus.link('A', 'B');
    bus.link('B', 'C');
    bus.link('C', 'D');
    const got: MeshPacket[] = [];
    engines[3].subscribe('CHAT', p => got.push(p));
    await engines[0].send({type: 'CHAT', payload: 'x', recipient: 'D', nonce: 'n'});
    await tick(10);
    expect(got[0].hops).toBe(2);
  });

  it('does not echo a relayed packet back to the phone it came from', async () => {
    const bus = new DynamicBus();
    const engines = ['A', 'B', 'C'].map(id => new MeshEngine(bus.add(id), id));
    await Promise.all(engines.map(e => e.start()));
    bus.link('A', 'B');
    bus.link('B', 'C');
    await engines[0].send({type: 'CHAT', payload: 'x', recipient: 'C', nonce: 'n'});
    await tick(10);
    const relayedByB = bus.sent.filter(s => s.from === 'B');
    expect(relayedByB).toHaveLength(1);
    expect(relayedByB[0].except).toBe('A');
  });

  it('STORE-AND-FORWARD: B carries the message and hands it to C when C arrives later', async () => {
    const bus = new DynamicBus();
    const engines = ['A', 'B', 'C'].map(id => new MeshEngine(bus.add(id), id));
    await Promise.all(engines.map(e => e.start()));
    bus.link('A', 'B'); // C is nowhere near anyone yet

    const gotC: MeshPacket[] = [];
    engines[2].subscribe('CHAT', p => gotC.push(p));

    await engines[0].send({type: 'CHAT', payload: 'wait for me', recipient: 'C', nonce: 'n'});
    await tick(10);
    expect(gotC).toHaveLength(0);
    expect(engines[1].carriedCount).toBe(1); // B is holding it

    // Time passes, then C walks into B's range.
    await tick(60_000);
    bus.link('B', 'C');
    await tick(3_000);

    expect(gotC).toHaveLength(1);
    expect(gotC[0].payload).toBe('wait for me');
  });

  it('survives a flapping B↔C link (message sent while the link was down)', async () => {
    const bus = new DynamicBus();
    const engines = ['A', 'B', 'C'].map(id => new MeshEngine(bus.add(id), id));
    await Promise.all(engines.map(e => e.start()));
    bus.link('A', 'B');
    bus.link('B', 'C');
    bus.unlink('B', 'C'); // link drops...

    const gotC: MeshPacket[] = [];
    engines[2].subscribe('CHAT', p => gotC.push(p));
    await engines[0].send({type: 'CHAT', payload: 'hello again', recipient: 'C', nonce: 'n'});
    await tick(10);
    expect(gotC).toHaveLength(0);

    bus.link('B', 'C'); // ...and comes back
    await tick(3_000);
    expect(gotC).toHaveLength(1);
  });

  it('never carries presence beacons or call audio', async () => {
    const bus = new DynamicBus();
    const engines = ['A', 'B'].map(id => new MeshEngine(bus.add(id), id));
    await Promise.all(engines.map(e => e.start()));
    bus.link('A', 'B');
    await engines[0].send({type: 'PRESENCE', payload: 'p'});
    await engines[0].send({type: 'CALL', payload: 'a:1:xx', recipient: 'Z'});
    await tick(10);
    expect(engines[1].carriedCount).toBe(0);
  });

  it('forgets carried packets after they expire', async () => {
    const bus = new DynamicBus();
    const engines = ['A', 'B', 'C'].map(id => new MeshEngine(bus.add(id), id));
    await Promise.all(engines.map(e => e.start()));
    bus.link('A', 'B');
    const gotC: MeshPacket[] = [];
    engines[2].subscribe('SOS', p => gotC.push(p));
    await engines[0].send({type: 'SOS', payload: 'help'});
    await tick(10);
    expect(engines[1].carriedCount).toBe(1);

    await tick(60 * 60 * 1000); // an hour: SOS carry window (45 min) is over
    bus.link('B', 'C');
    await tick(3_000);
    expect(gotC).toHaveLength(0);
  });
});
