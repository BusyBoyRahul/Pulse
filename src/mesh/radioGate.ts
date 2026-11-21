import {create} from 'zustand';
import {useSettingsStore} from '@/store/settingsStore';

/**
 * Pulse's Bluetooth / Wi-Fi radio part (Nearby) runs ONLY when the person has turned the mesh on (it is off until they do).
 * Wi-Fi / Bluetooth are switched on only as a result of the person switching the mesh on (or pressing SOS) - never when Pulse
 * just opens. If they turn Wi-Fi or Bluetooth off, the radio stops and leaves them off. (Messages over the internet are not
 * affected: they run without this.)
 */

/** What the radio part is doing right now, for the Nearby tab. */
export type RadioState = 'off' | 'starting' | 'on' | 'wifi-off' | 'bluetooth-off' | 'error' | 'unsupported';
export const useRadioStore = create<{state: RadioState}>(() => ({state: 'off'}));
export const setRadioState = (state: RadioState) => useRadioStore.setState({state});

// An SOS the person just sent asks for the radio too, for a while.
let sosBoost = false;
const listeners = new Set<() => void>();

/** Does the person want the radio on: the mesh switch on the Nearby tab, or an SOS they just sent. */
export const radioWanted = (): boolean => useSettingsStore.getState().app.meshOn || sosBoost;

// The person just switched the mesh on (or pressed SOS): only then may the radio switch their Wi-Fi / Bluetooth ON. Used once.
let powerOnGrant = false;
export const grantPowerOn = (): void => {
  powerOnGrant = true;
};
export const takePowerOnGrant = (): boolean => {
  const g = powerOnGrant;
  powerOnGrant = false;
  return g;
};

export function setSosBoost(on: boolean): void {
  sosBoost = on;
  listeners.forEach(f => f());
}

/** Call back whenever the wish may have changed. Returns a function that stops listening. */
export function onRadioWishChange(fn: () => void): () => void {
  listeners.add(fn);
  let last = useSettingsStore.getState().app.meshOn;
  const off = useSettingsStore.subscribe(s => {
    if (s.app.meshOn !== last) {
      last = s.app.meshOn;
      fn();
    }
  });
  return () => {
    listeners.delete(fn);
    off();
  };
}
