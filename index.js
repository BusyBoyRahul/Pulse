/**
 * Pulse — offline mesh safety app.
 * Entry point registered with the native app shell.
 */
// Must be first: provides crypto.getRandomValues for tweetnacl's key/nonce gen.
import 'react-native-get-random-values';
import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

AppRegistry.registerComponent(appName, () => App);
