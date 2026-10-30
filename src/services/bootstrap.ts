import {useMeshStore} from '@/mesh/meshStore';
import {useContactsStore} from '@/store/contactsStore';
import {useSettingsStore} from '@/store/settingsStore';
import {useChatStore} from '@/store/chatStore';
import {usePairingStore} from '@/store/pairingStore';
import {useGroupsStore} from '@/store/groupsStore';
import {usePeersStore} from '@/store/peersStore';
import {responder} from '@/services/responder';
import {lanManager} from '@/lan/lanManager';
import {useCallStore} from '@/store/callStore';
import {startNotificationBridge} from '@/services/notificationBridge';
import {usePrefsStore} from '@/store/prefsStore';
import {requestMeshPermissions} from '@/services/permissions';

let started = false;

/**
 * One-time session bootstrap: hydrate local stores, bring the BLE mesh online,
 * and attach everything that rides on it (SOS relay bridge, community responder,
 * presence, pairing, groups, chat). Called when the main tabs mount.
 */
export function bootstrapMesh(): void {
  if (started) {
    return;
  }
  started = true;

  useContactsStore.getState().hydrate();
  useSettingsStore.getState().hydrate();
  usePrefsStore.getState().hydrate();

  // Make sure the peer-discovery permissions are granted before the radio
  // starts — otherwise Nearby silently fails and no devices ever appear.
  void requestMeshPermissions()
    .catch(() => undefined)
    .then(() => useMeshStore.getState().start())
    .then(() => {
      const engine = useMeshStore.getState().engine;
      if (!engine) {
        return;
      }
      responder.attach(engine);
      useChatStore.getState().init();
      usePairingStore.getState().init();
      useGroupsStore.getState().init();
      usePeersStore.getState().start();
      useCallStore.getState().init();
      startNotificationBridge();
      // Wi-Fi direct transport (same-LAN fast media). Server-less.
      try {
        lanManager.start();
      } catch {
        /* Wi-Fi transport unavailable — Bluetooth mesh still works. */
      }
    });
}
