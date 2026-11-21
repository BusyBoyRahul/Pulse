import {useCallStore} from '@/store/callStore';
import {useInternetCallStore} from '@/net/internetCall';
import {useCallLogStore, CallOutcome} from '@/store/callLogStore';
import {displayName} from '@/services/names';

/**
 * Turns "a call just ended" into a line in the call history. It only WATCHES the two
 * call engines (Bluetooth/Wi-Fi and internet) — they do not know the log exists.
 */
type Ctx = {key: string; name: string; direction: 'incoming' | 'outgoing'; video: boolean; via: 'mesh' | 'internet'; at: number; answeredAt: number | null};

function outcomeOf(ctx: Ctx, reason: string | null): CallOutcome {
  if (ctx.answeredAt) {
    return 'answered';
  }
  const r = (reason ?? '').toLowerCase();
  if (r.includes('declin')) {
    return 'declined';
  }
  if (r.includes('busy')) {
    return 'busy';
  }
  if (r.includes('could not') || r.includes('permission') || r.includes('needs android') || r.includes('no internet')) {
    return 'failed';
  }
  return ctx.direction === 'incoming' ? 'missed' : 'no-answer';
}

function track(
  read: () => {phase: string; peerKey: string | null; name: string; video: boolean; reason: string | null},
  subscribe: (fn: () => void) => () => void,
  via: 'mesh' | 'internet',
) {
  let ctx: Ctx | null = null;
  let prev = read().phase;

  const finish = (reason: string | null) => {
    if (!ctx) {
      return;
    }
    const c = ctx;
    ctx = null;
    const now = Date.now();
    useCallLogStore.getState().add({
      peerKey: c.key,
      name: displayName(c.key, c.name),
      direction: c.direction,
      outcome: outcomeOf(c, reason),
      video: c.video,
      via: c.via,
      at: c.at,
      durationMs: c.answeredAt ? Math.max(0, now - c.answeredAt) : 0,
    });
  };

  subscribe(() => {
    const s = read();
    if (s.phase === prev) {
      return;
    }
    const was = prev;
    prev = s.phase;
    if ((s.phase === 'outgoing' || s.phase === 'incoming') && s.peerKey && !ctx) {
      ctx = {key: s.peerKey, name: s.name, direction: s.phase, video: s.video, via, at: Date.now(), answeredAt: null};
    } else if (s.phase === 'active' && ctx && !ctx.answeredAt) {
      ctx.answeredAt = Date.now();
    } else if (s.phase === 'ended' || (s.phase === 'idle' && was !== 'ended')) {
      finish(s.reason);
    }
  });
}

let started = false;
export function startCallLog(): void {
  if (started) {
    return;
  }
  started = true;
  useCallLogStore.getState().hydrate();
  track(
    () => {
      const s = useCallStore.getState();
      return {phase: s.phase, peerKey: s.peerKey, name: s.peerName, video: false, reason: s.endReason};
    },
    fn => useCallStore.subscribe(fn),
    'mesh',
  );
  track(
    () => {
      const s = useInternetCallStore.getState();
      return {phase: s.phase === 'connecting' ? 'outgoing' : s.phase, peerKey: s.peerKey, name: s.name, video: s.video, reason: s.endedReason};
    },
    fn => useInternetCallStore.subscribe(fn),
    'internet',
  );
}
