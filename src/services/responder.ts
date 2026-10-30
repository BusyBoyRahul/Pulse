import type {MeshEngine} from '@/mesh/meshEngine';
import type {MeshPacket} from '@/types';
import {useSettingsStore} from '@/store/settingsStore';
import {decodeSosBroadcast} from '@/sos/sosPacket';

/**
 * Nearby SOS alerts.
 *
 * When someone presses SOS, their phone broadcasts a readable help alert over
 * the mesh. Every nearby Pulse phone (that hasn't opted out) shows it — who
 * needs help and, if shared, where — so people around can actually respond.
 * Relaying the alert onward stays silent; this only governs the local banner.
 */
const MAX_ALERT_AGE_MS = 30 * 60 * 1000;

class Responder {
  private unsub: (() => void) | null = null;

  attach(engine: MeshEngine): void {
    if (this.unsub) {
      return;
    }
    this.unsub = engine.subscribe('SOS', (packet: MeshPacket) => {
      if (!useSettingsStore.getState().responderMode) {
        return; // user opted out of nearby alerts
      }
      const b = decodeSosBroadcast(packet.payload);
      // Relay phones hand SOS alerts to people who arrive later. Don't ring the
      // alarm for one that is no longer fresh.
      if (b?.t && Date.now() - b.t > MAX_ALERT_AGE_MS) {
        return;
      }
      useSettingsStore.getState().raiseResponderAlert({
        id: packet.id,
        at: Date.now(),
        name: b?.n,
        lat: b?.lat,
        lng: b?.lng,
        note: b?.note,
      });
    });
  }

  detach(): void {
    this.unsub?.();
    this.unsub = null;
  }
}

export const responder = new Responder();
export default responder;
