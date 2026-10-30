import type {MeshEngine} from '@/mesh/meshEngine';
import type {MeshPacket} from '@/types';

// Mock the network + storage layers so we can drive online/offline transitions.
jest.mock('@/services/apiService', () => ({
  __esModule: true,
  default: {post: jest.fn()},
  api: {post: jest.fn()},
}));

import api from '@/services/apiService';
import {sosRelayBridge} from '../sosRelayBridge';

const mockedPost = api.post as jest.Mock;

/** Minimal fake engine that lets us push SOS packets into the bridge. */
function fakeEngine(): {engine: MeshEngine; emitSos: (p: Partial<MeshPacket>) => void} {
  let handler: ((p: MeshPacket) => void) | null = null;
  const engine = {
    subscribe: (_type: string, h: (p: MeshPacket) => void) => {
      handler = h;
      return () => {
        handler = null;
      };
    },
  } as unknown as MeshEngine;
  return {
    engine,
    emitSos: p =>
      handler?.({
        id: p.id ?? 'pkt-1',
        type: 'SOS',
        ttl: 5,
        origin: p.origin ?? 'VICTIMKEY',
        payload: p.payload ?? 'sealed',
        originTimestamp: p.originTimestamp ?? 1,
      }),
  };
}

const flush = async () => {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
};

describe('sosRelayBridge — offline resilience', () => {
  beforeEach(() => {
    mockedPost.mockReset();
    sosRelayBridge.detach();
  });

  afterEach(() => {
    sosRelayBridge.detach(); // clear the retry interval so Jest can exit
  });

  it('keeps a heard SOS queued while offline, then delivers when back online', async () => {
    const {engine, emitSos} = fakeEngine();

    // Offline: the POST rejects.
    mockedPost.mockRejectedValue(new Error('Network Error'));
    sosRelayBridge.attach(engine);
    emitSos({id: 'sos-A'});
    await flush();

    expect(mockedPost).toHaveBeenCalledWith('/sos/relay', expect.objectContaining({packetId: 'sos-A'}));
    expect(sosRelayBridge.pending).toBe(1); // still carried

    // Back online: the queue drains.
    mockedPost.mockResolvedValue({ok: true});
    await (sosRelayBridge as unknown as {flush: () => Promise<void>}).flush();
    await flush();

    expect(sosRelayBridge.pending).toBe(0);
  });

  it('de-duplicates the same packet id heard from multiple relays', async () => {
    const {engine, emitSos} = fakeEngine();
    mockedPost.mockRejectedValue(new Error('offline'));
    sosRelayBridge.attach(engine);

    emitSos({id: 'sos-B'});
    emitSos({id: 'sos-B'}); // same alert, different relay
    emitSos({id: 'sos-B'});
    await flush();

    expect(sosRelayBridge.pending).toBe(1);
  });
});
