// index.js
// Polyfills MUST be imported first
import 'react-native-url-polyfill/auto';
import 'react-native-get-random-values';

// Optionally force override if needed (safety)
/*
import { URL as RNURL, URLSearchParams as RNURLSearchParams } from 'react-native-url-polyfill';
globalThis.URL = RNURL;
globalThis.URLSearchParams = RNURLSearchParams;
*/

import 'react-native-gesture-handler';

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

// Debug: verify protocol setter exists
console.log(
  '[BOOT] URL protocol setter present?',
  !!Object.getOwnPropertyDescriptor(URL.prototype, 'protocol')?.set,
);

AppRegistry.registerComponent(appName, () => App);
