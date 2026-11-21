import {AppState} from 'react-native';
import {useSessionStore} from '@/store/sessionStore';
import {checkSim} from '@/services/simWatch';
import {activeAccount, updateActiveAccount} from '@/services/storage';
import {useMeshStore} from '@/mesh/meshStore';
import {useContactsStore} from '@/store/contactsStore';
import {useSettingsStore} from '@/store/settingsStore';
import {useChatStore} from '@/store/chatStore';
import {usePairingStore} from '@/store/pairingStore';
import {useGroupsStore} from '@/store/groupsStore';
import {useSecretStore} from '@/store/secretStore';
import {useStatusStore} from '@/store/statusStore';
import {usePeersStore} from '@/store/peersStore';
import {responder} from '@/services/responder';
import {lanManager} from '@/lan/lanManager';
import {startMeshRules} from '@/mesh/meshAuto';
import {useCallStore} from '@/store/callStore';
import {startNotificationBridge} from '@/services/notificationBridge';
import {usePrefsStore} from '@/store/prefsStore';
import {requestMeshPermissions} from '@/services/permissions';
import {watchInternetMode} from '@/net/internet';
import {startDirectoryService} from '@/net/directoryService';
import {startProfileSync} from '@/services/profileSync';
import {startCallLog} from '@/services/callLog';

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
  // If the number was confirmed, notice a changed SIM card (now, and each time Pulse comes back to the screen).
  void checkSim();
  AppState.addEventListener('change', st => {
    if (st === 'active') {
      void checkSim();
    }
  });
  // An account verified before numbers were tracked per account: record it now, so the same number cannot be added elsewhere.
  const sess = useSessionStore.getState();
  if (sess.phone && sess.phoneVerified && !activeAccount().phone) {
    updateActiveAccount({phone: sess.phone.replace(/\D/g, '')});
  }

  // Make sure the peer-discovery permissions are granted before the radio
  // starts — otherwise Nearby silently fails and no devices ever appear.
  void requestMeshPermissions()
    .catch(() => undefined)
    .then(() => {
      // The engine always starts (it carries messages that come over the internet too). Its Bluetooth / Wi-Fi radio part only
      // comes on while the Nearby-tab switch is on, and only while the phone's own Wi-Fi and Bluetooth are on.
      return useMeshStore.getState().start();
    })
    .then(() => {
      const engine = useMeshStore.getState().engine;
      if (!engine) {
        return;
      }
      responder.attach(engine);
      useChatStore.getState().init();
      usePairingStore.getState().init();
      useGroupsStore.getState().init();
      useSecretStore.getState().init();
      useStatusStore.getState().init();
      usePeersStore.getState().start();
      useCallStore.getState().init();
      startNotificationBridge();
      startMeshRules();
      watchInternetMode();
      startDirectoryService();
      startProfileSync();
      startCallLog();
      // Wi-Fi direct transport (same-LAN fast media). Server-less. Part of the mesh: it stays off while the mesh switch is off.
      try {
        if (useSettingsStore.getState().app.meshOn) {
          lanManager.start();
        }
      } catch {
        /* Wi-Fi transport unavailable — Bluetooth mesh still works. */
      }
    });
}
