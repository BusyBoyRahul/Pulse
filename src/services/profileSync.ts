import {usePairingStore} from '@/store/pairingStore';
import {usePeersStore} from '@/store/peersStore';
import {usePrefsStore} from '@/store/prefsStore';
import {useSessionStore} from '@/store/sessionStore';
import {useSettingsStore} from '@/store/settingsStore';

/**
 * Who sees my profile photo and "about".
 *
 *  - Everyone nearby: they ride the public Bluetooth/Wi-Fi hello (peersStore).
 *  - My connections: they are NOT in the public hello. Instead each connected person
 *    gets them in a private, end-to-end encrypted message (this file) — so strangers
 *    nearby, and the relays, never see them.
 *  - Nobody: they are sent to no one (people only get my name).
 *
 * My name is always shared (people need something to call me).
 */
export type ProfileWire = {k: 'prof'; n: string; /** photo thumb (''=removed) */ a?: string; /** about (''=removed) */ b?: string};

type SendFn = (peerKey: string, ev: ProfileWire) => void;
let sender: SendFn | null = null;
/** chatStore hands over its "send an encrypted message to one person" here. */
export function onProfileSend(fn: SendFn): void {
  sender = fn;
}

const AGAIN_MS = 30 * 60 * 1000;
const sent = new Map<string, {sig: string; at: number}>();

function build(): ProfileWire {
  const s = useSessionStore.getState();
  const a = useSettingsStore.getState().app;
  return {
    k: 'prof',
    n: s.profileName || 'Pulse user',
    a: a.photoAudience === 'nobody' ? '' : s.avatarThumb ?? '',
    b: a.aboutAudience === 'nobody' ? '' : s.bio ?? '',
  };
}

/** Send my current profile to one connected person (skips if they already have exactly this). */
export function syncProfileTo(peerKey: string, force = false): void {
  const pairing = usePairingStore.getState();
  if (!pairing.isPaired(peerKey) || usePrefsStore.getState().isBlocked(peerKey)) {
    return;
  }
  const w = build();
  const sig = JSON.stringify(w);
  const prev = sent.get(peerKey);
  if (!force && prev && prev.sig === sig && Date.now() - prev.at < AGAIN_MS) {
    return;
  }
  sent.set(peerKey, {sig, at: Date.now()});
  sender?.(peerKey, w);
}

export function syncProfileAll(force = false): void {
  usePairingStore.getState().paired.forEach(p => syncProfileTo(p.publicKey, force));
}

/** Someone connected sent me their profile. */
export function applyProfile(from: string, w: ProfileWire): void {
  if (!usePairingStore.getState().isPaired(from) || usePrefsStore.getState().isBlocked(from)) {
    return;
  }
  const okB64 = (s: unknown) => typeof s === 'string' && s.length <= 24000 && /^[A-Za-z0-9+/=]*$/.test(s);
  usePrefsStore.getState().remember(from, {
    name: typeof w.n === 'string' ? w.n.slice(0, 40) : undefined,
    avatar: okB64(w.a) ? (w.a ? `data:image/jpeg;base64,${w.a}` : '') : undefined,
    bio: typeof w.b === 'string' ? w.b.slice(0, 80) : undefined,
    seenAt: Date.now(),
  });
}

let started = false;
/** Keep connected people up to date: when they arrive, when I connect, when my profile or audience changes. */
export function startProfileSync(): void {
  if (started) {
    return;
  }
  started = true;
  usePeersStore.subscribe((s, prev) => {
    for (const k of Object.keys(s.peers)) {
      if (!prev.peers[k]) {
        syncProfileTo(k);
      }
    }
  });
  usePairingStore.subscribe((s, prev) => {
    for (const p of s.paired) {
      if (!prev.paired.some(q => q.publicKey === p.publicKey)) {
        syncProfileTo(p.publicKey, true);
      }
    }
  });
  let last = useSessionStore.getState();
  useSessionStore.subscribe(s => {
    if (s.profileName !== last.profileName || s.avatarThumb !== last.avatarThumb || s.bio !== last.bio) {
      syncProfileAll(true);
    }
    last = s;
  });
  let lastApp = useSettingsStore.getState().app;
  useSettingsStore.subscribe(s => {
    if (s.app.photoAudience !== lastApp.photoAudience || s.app.aboutAudience !== lastApp.aboutAudience) {
      syncProfileAll(true);
    }
    lastApp = s.app;
  });
  setInterval(() => syncProfileAll(), 10 * 60 * 1000);
  setTimeout(() => syncProfileAll(), 3000);
}
