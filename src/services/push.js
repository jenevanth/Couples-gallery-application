// src/services/push.js
import { Platform, PermissionsAndroid } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import { supabase } from '../services/supabase';

const log = (...a) => console.log('[Push]', ...a);

// Ask for notifications permission (Android 13+ + iOS)
async function requestNotificationPermission() {
  try {
    if (Platform.OS === 'android') {
      // Android 13+ explicit permission
      const res = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
      log('POST_NOTIFICATIONS permission:', res);
    }
    // iOS (and harmless on Android)
    const authStatus = await messaging().requestPermission();
    log('messaging().requestPermission status:', authStatus);
    return authStatus;
  } catch (e) {
    log('requestNotificationPermission exception:', e);
    return null;
  }
}

// Save token in Supabase devices (household_id auto-filled by DB trigger)
async function saveTokenToSupabase(userId, token) {
  try {
    const { error } = await supabase.from('devices').upsert({
      user_id: userId,
      token,
      platform: Platform.OS,
    });
    if (error) log('devices upsert error:', error);
    else log('devices upsert OK for token:', token.slice(0, 12) + '...');
  } catch (e) {
    log('saveTokenToSupabase exception:', e);
  }
}

/**
 * Register for push, save token, and set listeners.
 *
 * @param {string} userId - Supabase auth user id
 * @param {(rm: import('@react-native-firebase/messaging').FirebaseMessagingTypes.RemoteMessage) => void} onOpenNotification
 *        Optional callback when user opens a notification (foreground/background/cold-start).
 *        Typical usage: navigate to rm.data?.screen with params.
 */
export async function registerDeviceToken(userId, onOpenNotification) {
  try {
    if (!userId) {
      log('registerDeviceToken aborted: no userId');
      return { unsubscribe: () => {}, token: null };
    }

    // 1) Ask for permission
    await requestNotificationPermission();

    // 2) Get token
    const token = await messaging().getToken();
    log('FCM token:', token);
    await saveTokenToSupabase(userId, token);

    // 3) Token refresh
    const unsubscribeTokenRefresh = messaging().onTokenRefresh(
      async newToken => {
        log('FCM token refreshed:', newToken);
        await saveTokenToSupabase(userId, newToken);
      },
    );

    // 4) Foreground messages
    const unsubscribeOnMessage = messaging().onMessage(async remoteMessage => {
      log('Foreground FCM message:', JSON.stringify(remoteMessage));
      // Optional: show a toast/snackbar/local notif here (Notifee, etc.)
    });

    // 5) When app is background and the user taps the notification
    const unsubscribeOnOpen = messaging().onNotificationOpenedApp(
      remoteMessage => {
        log(
          'Notification caused app to open (background):',
          JSON.stringify(remoteMessage),
        );
        try {
          onOpenNotification?.(remoteMessage);
        } catch (e) {
          log('onOpenNotification error:', e);
        }
      },
    );

    // 6) Cold start (app launched by tapping a notification)
    const initial = await messaging().getInitialNotification();
    if (initial) {
      log(
        'App opened from quit state by notification:',
        JSON.stringify(initial),
      );
      try {
        onOpenNotification?.(initial);
      } catch (e) {
        log('onOpenNotification (initial) error:', e);
      }
    }

    // Return unsubscribe bundle for cleanup
    const unsubscribeAll = () => {
      try {
        unsubscribeTokenRefresh?.();
        unsubscribeOnMessage?.();
        unsubscribeOnOpen?.();
        log('Push listeners unsubscribed');
      } catch (e) {
        log('unsubscribeAll error:', e);
      }
    };

    return { unsubscribe: unsubscribeAll, token };
  } catch (e) {
    log('registerDeviceToken exception:', e);
    return { unsubscribe: () => {}, token: null };
  }
}

/**
 * Optional: call this on sign out if you want to remove this device token.
 * Note: by default, our devices table has INSERT/UPDATE RLS but not DELETE.
 * If you add a DELETE policy, you can enable this.
 */
// export async function deregisterDeviceToken(userId) {
//   try {
//     const token = await messaging().getToken();
//     const { error } = await supabase.from('devices').delete().match({ user_id: userId, token });
//     if (error) log('devices delete error:', error);
//     else log('devices row deleted for token:', token.slice(0, 12) + '...');
//   } catch (e) {
//     log('deregisterDeviceToken exception:', e);
//   }
// }
