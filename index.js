// index.js (React Native entry)
import 'react-native-url-polyfill/auto'; // IMPORTANT: must be first (fixes URL.* setters on Hermes)
import 'react-native-get-random-values'; // crypto.getRandomValues for UUIDs (used by libraries like Supabase)
import 'react-native-gesture-handler';

import { AppRegistry } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import notifee, { AndroidImportance, EventType } from '@notifee/react-native';
import App from './App';
import { name as appName } from './app.json';

const log = (...a) => console.log('[Index]', ...a);

async function ensureDefaultChannel() {
  await notifee.createChannel({
    id: 'default',
    name: 'Default',
    importance: AndroidImportance.HIGH,
    sound: 'default',
  });
}

async function displayLocal(remoteMessage) {
  await ensureDefaultChannel();
  await notifee.displayNotification({
    title:
      remoteMessage?.notification?.title ??
      remoteMessage?.data?.title ??
      'New Photo Uploaded! 📸',
    body:
      remoteMessage?.notification?.body ??
      remoteMessage?.data?.body ??
      'Check out the latest addition',
    data: remoteMessage?.data,
    android: {
      channelId: 'default',
      // If you don't have a custom small icon yet, comment this out:
      smallIcon: 'ic_notification',
      pressAction: { id: 'default' },
    },
  });
}

// Background/quit messages (must be in the entry file)
messaging().setBackgroundMessageHandler(async remoteMessage => {
  log('BG message:', remoteMessage?.messageId);
  // Avoid duplicates: only display local if it's data-only
  if (!remoteMessage?.notification) {
    await displayLocal(remoteMessage);
  }
});

// Notifee background events (notification taps/actions while app is killed)
notifee.onBackgroundEvent(async ({ type, detail }) => {
  if (type === EventType.PRESS) {
    log('Notifee BG press:', detail?.notification?.data);
    // Persist data if you want to navigate after app starts
  }
});

AppRegistry.registerComponent(appName, () => App);

// // index.js
// // Polyfills MUST be imported first
// import 'react-native-url-polyfill/auto';
// import 'react-native-get-random-values';

// // Optionally force override if needed (safety)
// /*
// import { URL as RNURL, URLSearchParams as RNURLSearchParams } from 'react-native-url-polyfill';
// globalThis.URL = RNURL;
// globalThis.URLSearchParams = RNURLSearchParams;
// */

// import 'react-native-gesture-handler';

// import { AppRegistry } from 'react-native';
// import App from './App';
// import { name as appName } from './app.json';

// // Debug: verify protocol setter exists
// console.log(
//   '[BOOT] URL protocol setter present?',
//   !!Object.getOwnPropertyDescriptor(URL.prototype, 'protocol')?.set,
// );

// AppRegistry.registerComponent(appName, () => App);
