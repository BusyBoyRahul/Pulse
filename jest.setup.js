/* Mocks for native modules so unit tests run in plain Node. */

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('react-native-udp', () => ({createSocket: () => ({})}));
jest.mock('react-native-tcp-socket', () => ({createServer: () => ({listen() {}, close() {}}), createConnection: () => ({})}));
jest.mock('react-native-geolocation-service', () => ({getCurrentPosition: () => {}}));
jest.mock('react-native-send-direct-sms', () => ({SendDirectSms: async () => true}));
jest.mock('react-native-image-picker', () => ({launchImageLibrary: async () => ({}), launchCamera: async () => ({})}));
jest.mock('@react-native-clipboard/clipboard', () => ({setString() {}, getString: async () => ''}));

jest.mock('react-native-ble-plx', () => ({
  BleManager: class {},
  State: {PoweredOn: 'PoweredOn', PoweredOff: 'PoweredOff'},
}));
