/**
 * Pulse — private messenger.
 * Entry point registered with the native app shell.
 */
// Must be first: gesture handler needs to hook in before anything else renders.
import 'react-native-gesture-handler';
// Provides crypto.getRandomValues for tweetnacl's key/nonce generation.
import 'react-native-get-random-values';
import {AppRegistry} from 'react-native';
import Boot from './Boot';
import {name as appName} from './app.json';

AppRegistry.registerComponent(appName, () => Boot);
