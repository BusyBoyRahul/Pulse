import {create} from 'zustand';
import config from '@/config';
import type {SosState} from '@/types';
import {newPacketId} from '@/mesh/relayProtocol';
import {getMeshEngine} from '@/mesh/bleManager';
import locationService, {Fix} from '@/services/locationService';
import {buildSosBroadcast, encodeSosBroadcast} from '@/sos/sosPacket';
import {smsService, SosSmsResult} from '@/services/smsService';
import {useSessionStore} from './sessionStore';
import {useContactsStore} from './contactsStore';

type SosStore = {
  state: SosState;
  fix: Fix | null;
  countdownMs: number;
  packetId: string | null;
  error: string | null;
  smsResult: SosSmsResult | null;

  /** Called when the press-and-hold completes: start the cancel window. */
  beginCountdown: (note?: string) => void;
  cancel: () => void;
  reset: () => void;
};

let tickTimer: ReturnType<typeof setInterval> | null = null;

function clearTimers() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

export const useSosStore = create<SosStore>((set, get) => ({
  state: 'idle',
  fix: null,
  countdownMs: config.sosCancelWindowMs,
  packetId: null,
  error: null,
  smsResult: null,

  beginCountdown: (note?: string) => {
    clearTimers();
    const packetId = newPacketId();
    set({
      state: 'countdown',
      packetId,
      countdownMs: config.sosCancelWindowMs,
      error: null,
      fix: null,
      smsResult: null,
    });

    // Grab a location fix in parallel with the countdown — never block on it.
    void locationService.tryGetCurrent().then(fix => {
      if (get().packetId === packetId) {
        set({fix});
      }
    });

    const startedAt = Date.now();
    tickTimer = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, config.sosCancelWindowMs - elapsed);
      set({countdownMs: remaining});
      if (remaining <= 0) {
        clearTimers();
        void dispatch(packetId, note);
      }
    }, 100);
  },

  cancel: () => {
    clearTimers();
    set({state: 'cancelled'});
  },

  reset: () => {
    clearTimers();
    set({
      state: 'idle',
      packetId: null,
      fix: null,
      error: null,
      smsResult: null,
      countdownMs: config.sosCancelWindowMs,
    });
  },
}));

/**
 * Deliver the alert. SOS is FIRST a call for help to everyone nearby — it
 * broadcasts a readable alert (name + location) over the mesh so any Pulse phone
 * around you can see who needs help and where. It ALSO texts your trusted
 * contacts from this phone's SIM, if you've added any. It works with zero
 * contacts — the nearby broadcast is the primary purpose.
 */
async function dispatch(packetId: string, note?: string): Promise<void> {
  const store = useSosStore;
  const {profileName} = useSessionStore.getState();
  const trusted = useContactsStore.getState().contacts;
  const fix = store.getState().fix;

  // 1) Broadcast a help alert to every nearby Pulse phone (readable — that's the
  //    point). Multi-hop so it reaches phones a couple of relays away too.
  try {
    const payload = encodeSosBroadcast(
      buildSosBroadcast(fix, {name: profileName ?? undefined, note, at: Date.now()}),
    );
    await getMeshEngine().send({
      type: 'SOS',
      payload,
      id: packetId,
      ttl: config.defaultTtl,
    });
  } catch {
    /* mesh unavailable — SMS below may still reach contacts */
  }

  // 2) Also text trusted contacts from the SIM (secondary, optional).
  let smsResult: SosSmsResult = {sent: 0, failed: 0, supported: smsService.supported};
  if (trusted.length > 0) {
    try {
      smsResult = await smsService.sendSos(trusted, {name: profileName ?? undefined, fix, note});
    } catch {
      smsResult = {sent: 0, failed: trusted.length, supported: smsService.supported};
    }
  }
  store.setState({smsResult, state: 'sent', error: null});
}
