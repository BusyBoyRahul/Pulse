import type {PeripheralAdapter} from './types';

/**
 * Default advertiser used in dev/tests. Real builds inject an adapter backed by
 * `react-native-ble-advertiser` (Android) / a peripheral module (iOS). Kept as
 * a no-op so the central (scan/relay) path can run and be exercised without the
 * native advertising dependency. See docs/NATIVE_SETUP.md.
 */
export class NoopPeripheralAdapter implements PeripheralAdapter {
  readonly supported = false;

  async startAdvertising(serviceUUID: string): Promise<void> {
    if (__DEV__) {
      console.log(`[mesh] advertising is a no-op (service ${serviceUUID}). Wire a real advertiser for production.`);
    }
  }
  async updatePayload(): Promise<void> {}
  async stopAdvertising(): Promise<void> {}
}
