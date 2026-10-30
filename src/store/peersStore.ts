import {create} from 'zustand';
import naclUtil from 'tweetnacl-util';
import type {MeshPacket, Peer} from '@/types';
import {getMeshEngine} from '@/mesh/bleManager';
import {getIdentity} from '@/services/identity';
import {useSessionStore} from './sessionStore';
import {usePrefsStore} from './prefsStore';
import {useSettingsStore} from './settingsStore';

const PRESENCE_INTERVAL_MS = 10000;
const PEER_TTL_MS = 45000; // drop a peer we haven't heard from in this long
// A hello reaches people up to this many relays away (A→B→C is 1 relay).
const PRESENCE_TTL = 4;
// Keep the closest route we heard recently; only accept a longer one after it goes stale.
const ROUTE_STALE_MS = 25000;

// name + optional avatar thumb (base64) + optional short bio. NEVER anything else:
// no phone number, no contacts, no location — presence is broadcast to every
// phone in the mesh.
type PresencePayload = {n: string; a?: string; b?: string};

function encode(p: PresencePayload): string {
  return naclUtil.encodeBase64(naclUtil.decodeUTF8(JSON.stringify(p)));
}
function decode(s: string): PresencePayload | null {
  try {
    return JSON.parse(naclUtil.encodeUTF8(naclUtil.decodeBase64(s))) as PresencePayload;
  } catch {
    return null;
  }
}

/** Build the exact bytes of a presence hello (exported so tests can prove what
 *  is — and is not — shared with strangers). */
export function buildPresencePayload(name: string, avatarThumb?: string | null, bio?: string | null): string {
  return encode({n: name, a: avatarThumb ?? undefined, b: bio?.trim() ? bio.trim().slice(0, 80) : undefined});
}

type PeersState = {
  peers: Record<string, Peer>; // by public key
  subscribed: boolean;
  timer: ReturnType<typeof setInterval> | null;

  start: () => void;
  stop: () => void;
  list: () => Peer[];
  nameOf: (publicKey: string) => string;
  isOnline: (publicKey: string) => boolean;
  hopsTo: (publicKey: string) => number | null;
};

/**
 * Presence roster. Each device periodically broadcasts a PRESENCE hello with
 * its display name; every device builds a live list of nearby *identities*
 * (public key + name) — the people you can pair or start a group with.
 *
 * Hellos are relayed a few hops, so you also see people who are only reachable
 * THROUGH someone else (hops > 0) — and can message them the same way.
 */
export const usePeersStore = create<PeersState>((set, get) => ({
  peers: {},
  subscribed: false,
  timer: null,

  start: () => {
    const engine = getMeshEngine();
    if (!get().subscribed) {
      engine.subscribe('PRESENCE', (packet: MeshPacket) => {
        if (packet.origin === getIdentity().publicKey) {
          return;
        }
        if (usePrefsStore.getState().isBlocked(packet.origin)) {
          return; // blocked people don't show up
        }
        const p = decode(packet.payload);
        if (!p?.n) {
          return;
        }
        const avatar = p.a ? `data:image/jpeg;base64,${p.a}` : undefined;
        const hops = packet.hops ?? 0;
        const now = Date.now();
        usePrefsStore.getState().remember(packet.origin, {name: p.n, avatar, bio: p.b, seenAt: now});
        set(state => {
          const prev = state.peers[packet.origin];
          // Prefer the shortest recent route; a farther one only wins when the
          // closer one has gone quiet.
          const keepRoute = prev && prev.hops < hops && now - prev.lastSeen < ROUTE_STALE_MS;
          return {
            peers: {
              ...state.peers,
              [packet.origin]: {
                publicKey: packet.origin,
                name: p.n,
                lastSeen: keepRoute ? prev.lastSeen : now,
                hops: keepRoute ? prev.hops : hops,
                // Keep a previously-seen photo if this hello didn't include one.
                avatar: avatar ?? prev?.avatar,
                bio: p.b ?? prev?.bio,
              },
            },
          };
        });
      });
      set({subscribed: true});
    }

    if (get().timer) {
      return;
    }
    let tick = 0;
    const broadcast = () => {
      const session = useSessionStore.getState();
      const privacy = useSettingsStore.getState().app;
      const name = session.profileName || 'Pulse user';
      // "Appear in Nearby" off: stay quiet (this phone still receives and relays).
      if (privacy.discoverable) {
        // The hello is tiny and relayed several hops. The photo thumbnail is big,
        // so it only goes to direct neighbours (ttl 0 = never relayed), every 3rd beat.
        void engine.send({type: 'PRESENCE', ttl: PRESENCE_TTL, payload: buildPresencePayload(name, null, session.bio)});
        if (tick % 3 === 0 && session.avatarThumb && privacy.shareAvatar) {
          void engine.send({
            type: 'PRESENCE',
            ttl: 0,
            payload: buildPresencePayload(name, session.avatarThumb, session.bio),
          });
        }
      }
      tick += 1;
      // prune stale peers
      const cutoff = Date.now() - PEER_TTL_MS;
      set(state => {
        const peers = Object.fromEntries(
          Object.entries(state.peers).filter(([, v]) => v.lastSeen >= cutoff),
        );
        return {peers};
      });
    };
    broadcast();
    set({timer: setInterval(broadcast, PRESENCE_INTERVAL_MS)});
  },

  stop: () => {
    const t = get().timer;
    if (t) {
      clearInterval(t);
    }
    set({timer: null});
  },

  list: () =>
    Object.values(get().peers).sort((a, b) => a.hops - b.hops || b.lastSeen - a.lastSeen),

  nameOf: (publicKey: string) => get().peers[publicKey]?.name || publicKey.slice(0, 8),

  isOnline: (publicKey: string) => {
    const p = get().peers[publicKey];
    return !!p && Date.now() - p.lastSeen < PEER_TTL_MS;
  },

  hopsTo: (publicKey: string) => {
    const p = get().peers[publicKey];
    return p && Date.now() - p.lastSeen < PEER_TTL_MS ? p.hops : null;
  },
}));
