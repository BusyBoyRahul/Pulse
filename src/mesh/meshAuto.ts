import {AppState, NativeEventEmitter, NativeModules} from 'react-native';
import {useSettingsStore} from '@/store/settingsStore';
import {grantPowerOn} from './radioGate';

type NativeWifi = {
  watchWifi(): Promise<boolean>;
  isWifiOn(): Promise<boolean>;
  addListener(event: string): void;
  removeListeners(count: number): void;
};
const Nearby = NativeModules.NearbyMesh as NativeWifi | undefined;

const meshOn = () => useSettingsStore.getState().app.meshOn;
const setMesh = (on: boolean) => useSettingsStore.getState().setApp({meshOn: on});

/**
 * The person's four rules for the mesh and the phone's Wi-Fi:
 *  1. Mesh switched ON: the radio starts and Wi-Fi / Bluetooth are turned on (by Android's Nearby, see NearbyMeshTransport). The mesh
 *     stays on - it is never switched off just because Wi-Fi has not come on yet.
 *  2. Mesh OFF: Pulse never touches Wi-Fi or Bluetooth (nothing here starts anything while it is off).
 *  3. The person turns Wi-Fi OFF: the mesh switch turns itself off.
 *  4. Wi-Fi is ON (the person turns it on, or Pulse opens with it on): the mesh switch turns on only if "Mesh on by default" is on
 *     (it is off unless they choose it).
 */
let started = false;
export function startMeshRules(): void {
  if (started || !Nearby) {
    return;
  }
  started = true;

  // Has Wi-Fi been seen ON while the mesh was on? Only then does "Wi-Fi is off" mean the person turned it off (rule 3). If the mesh
  // was just switched on and Wi-Fi has not come on yet, the mesh keeps waiting and trying (rule 1).
  let seenOn = false;

  const wifiOff = () => {
    if (meshOn()) {
      setMesh(false); // rule 3
    }
    seenOn = false;
  };

  // Pulse just opened. The mesh was on but Wi-Fi is off now: the person turned it off while Pulse was closed -> off (rule 3).
  void Nearby.watchWifi()
    .then(on => {
      if (on) {
        // "Mesh on by default": Pulse opened and Wi-Fi is on -> the mesh is on too (it does not turn Wi-Fi on; it is on already).
        if (!meshOn() && useSettingsStore.getState().app.meshAutoOnWifi) {
          setMesh(true);
        }
        seenOn = meshOn();
      } else {
        wifiOff();
      }
    })
    .catch(() => undefined);

  const emitter = new NativeEventEmitter(NativeModules.NearbyMesh);
  emitter.addListener('WifiState', (e: {on: boolean}) => {
    if (!e.on) {
      wifiOff(); // rule 3
    } else {
      seenOn = meshOn();
      if (!meshOn() && useSettingsStore.getState().app.meshAutoOnWifi) {
        grantPowerOn();
        setMesh(true); // rule 4
      }
    }
  });

  // Rule 3 also when the event was missed (Wi-Fi turned off while Pulse was in the background or frozen): look again whenever Pulse
  // comes back to the screen and every 15 s while the mesh is on - but only if Wi-Fi had been on (never right after switching the
  // mesh on, when Android is still turning it on).
  const recheck = () => {
    if (!meshOn()) {
      return;
    }
    void Nearby.isWifiOn()
      .then(on => {
        if (on) {
          seenOn = true;
        } else if (seenOn) {
          wifiOff();
        }
      })
      .catch(() => undefined);
  };
  AppState.addEventListener('change', st => {
    if (st === 'active') {
      recheck();
    }
  });
  setInterval(recheck, 15000);

  // The mesh was just switched on (rule 1): note whether Wi-Fi is on already. Nothing else is done here - Android turns Wi-Fi on.
  let last = meshOn();
  useSettingsStore.subscribe(s => {
    const now = s.app.meshOn;
    if (now && !last) {
      void Nearby.isWifiOn()
        .then(on => {
          seenOn = on;
        })
        .catch(() => undefined);
    }
    last = now;
  });
}
