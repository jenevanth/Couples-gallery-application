// App.js
import 'react-native-url-polyfill/auto'; // Fix URL issues on Hermes (required by supabase)
import React, { useEffect } from 'react';
import { StatusBar, Platform, AppState } from 'react-native';
import { MenuProvider } from 'react-native-popup-menu';
import { NavigationContainer } from '@react-navigation/native';
import AppNavigator from './src/navigation/AppNavigator';
import { ThemeProvider } from './src/theme/ThemeContext';
import messaging from '@react-native-firebase/messaging';
import notifee, { AndroidImportance } from '@notifee/react-native';
import { supabase } from './src/services/supabase';

const log = (...a) => console.log('[App]', ...a);

/**
 * Ensure Android notification channel exists and permission is granted
 */
async function ensureNotificationsReady() {
  try {
    // iOS + Android 13+ runtime permission
    await notifee.requestPermission();

    // Android: create the "default" channel to match FCM payload channel_id
    if (Platform.OS === 'android') {
      await notifee.createChannel({
        id: 'default',
        name: 'Default',
        importance: AndroidImportance.HIGH,
        sound: 'default',
      });
    }
  } catch (e) {
    log('ensureNotificationsReady error:', e);
  }
}

/**
 * Display a local/system notification (used for foreground messages)
 */
async function displayLocal(remoteMessage) {
  try {
    await ensureNotificationsReady();

    const type = remoteMessage?.data?.type;
    const isChat = type === 'chat_message';

    const title =
      remoteMessage?.notification?.title ??
      remoteMessage?.data?.title ??
      (isChat ? 'New message 💬' : 'New notification');
    const body =
      remoteMessage?.notification?.body ??
      remoteMessage?.data?.text ??
      remoteMessage?.data?.body ??
      (isChat ? 'You have a new chat message' : 'You have a new update');

    await notifee.displayNotification({
      title,
      body,
      data: remoteMessage?.data,
      android: {
        channelId: 'default',
        // smallIcon: 'ic_notification', // optional if you added one
        pressAction: { id: 'default' },
      },
    });
  } catch (e) {
    log('displayLocal error:', e);
  }
}

/**
 * Register/Update the device token for the logged-in user
 * IMPORTANT: always include household_id so the Edge function can find tokens by household.
 */
async function registerFcmTokenForUser() {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      log('[App] No user, skipping FCM token registration.');
      return;
    }

    // FCM registration + token
    await messaging().registerDeviceForRemoteMessages();
    const token = await messaging().getToken();
    log('[App] FCM token:', token);
    if (!token) return;

    // Get household_id for this user
    const { data: prof, error: pErr } = await supabase
      .from('profiles')
      .select('household_id')
      .eq('id', user.id)
      .maybeSingle();
    if (pErr) log('[App] profiles fetch error for devices upsert:', pErr);
    const hh = prof?.household_id || null;

    // Always upsert (onConflict handles dupes); this ensures household_id is set/updated
    const { error } = await supabase.from('devices').upsert(
      {
        user_id: user.id,
        token,
        platform: Platform.OS,
        household_id: hh, // <-- critical for receiver push routing
        updated_at: new Date().toISOString(),
      },
      { onConflict: ['user_id', 'token'] },
    );

    if (error) log('[App] devices upsert error:', error);
    else log('[App] Device token upserted for user:', user.id, 'hh:', hh);
  } catch (e) {
    log('[App] registerFcmTokenForUser error:', e);
  }
}

/**
 * Navigation on notification (optional)
 */
function handleNotificationNavigation(notificationData) {
  if (!notificationData) return;
  const { type, image_id, household_id } = notificationData;
  log('Notification data for navigation:', { type, image_id, household_id });
  // TODO: Use a navigation ref to navigate based on type/deep_link
  // if (type === 'chat_message' && household_id) navRef.navigate('PrivateChat', { householdId: household_id });
}

const App = () => {
  useEffect(() => {
    let unsubForeground;
    let unsubTokenRefresh;
    let unsubNotificationOpened;
    let appStateSubscription;

    const init = async () => {
      try {
        await ensureNotificationsReady();

        // Ask FCM permission (iOS; Android pre-13 not needed)
        const authStatus = await messaging().requestPermission();
        const enabled =
          authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
          authStatus === messaging.AuthorizationStatus.PROVISIONAL;
        log('[App] messaging permission:', authStatus, 'enabled:', enabled);

        // Initial token registration
        await registerFcmTokenForUser();

        // Listen for auth state changes (login/logout) and (re)register token
        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
          if (session?.user) {
            log('[App] Auth changed: user logged in, registering FCM token');
            registerFcmTokenForUser();
          } else {
            log('[App] Auth changed: user logged out');
          }
        });

        // Listen for token refresh
        unsubTokenRefresh = messaging().onTokenRefresh(async newToken => {
          log('[App] FCM token refreshed:', newToken);
          await registerFcmTokenForUser();
        });

        // Foreground messages: show a local/system notification
        unsubForeground = messaging().onMessage(async remoteMessage => {
          log('[App] FCM foreground message:', remoteMessage);
          await displayLocal(remoteMessage);
        });

        // App opened from background by tapping notification
        unsubNotificationOpened = messaging().onNotificationOpenedApp(
          remoteMessage => {
            log(
              '[App] Notification opened app from background:',
              remoteMessage,
            );
            handleNotificationNavigation(remoteMessage?.data);
          },
        );

        // App opened from quit state by tapping notification
        messaging()
          .getInitialNotification()
          .then(remoteMessage => {
            if (remoteMessage) {
              log('[App] App opened by notification:', remoteMessage);
              handleNotificationNavigation(remoteMessage?.data);
            }
          });

        // Re-register token when app becomes active (optional safety)
        appStateSubscription = AppState.addEventListener(
          'change',
          nextAppState => {
            if (nextAppState === 'active') {
              log('[App] App came to foreground, checking FCM token');
              registerFcmTokenForUser();
            }
          },
        );

        return () => {
          try {
            subscription?.unsubscribe?.();
          } catch {}
        };
      } catch (e) {
        log('[App] Push init error:', e);
      }
    };

    init();

    return () => {
      try {
        unsubForeground && unsubForeground();
        unsubTokenRefresh && unsubTokenRefresh();
        unsubNotificationOpened && unsubNotificationOpened();
        appStateSubscription && appStateSubscription.remove();
      } catch (e) {
        // ignore
      }
    };
  }, []);

  return (
    <MenuProvider>
      <ThemeProvider>
        <NavigationContainer>
          <StatusBar barStyle="light-content" backgroundColor="#121212" />
          <AppNavigator />
        </NavigationContainer>
      </ThemeProvider>
    </MenuProvider>
  );
};

export default App;

// // App.js
// import 'react-native-url-polyfill/auto'; // Fix URL issues on Hermes (required by supabase)
// import React, { useEffect } from 'react';
// import { StatusBar, Platform, AppState } from 'react-native';
// import { MenuProvider } from 'react-native-popup-menu';
// import { NavigationContainer } from '@react-navigation/native';
// import AppNavigator from './src/navigation/AppNavigator';
// import { ThemeProvider } from './src/theme/ThemeContext';
// import messaging from '@react-native-firebase/messaging';
// import notifee, { AndroidImportance } from '@notifee/react-native';
// import { supabase } from './src/services/supabase';

// const log = (...a) => console.log('[App]', ...a);

// /**
//  * Ensure Android notification channel exists and permission is granted
//  */
// async function ensureNotificationsReady() {
//   try {
//     // iOS + Android 13+ runtime permission
//     await notifee.requestPermission();

//     // Android: create the "default" channel to match FCM payload channel_id
//     if (Platform.OS === 'android') {
//       await notifee.createChannel({
//         id: 'default',
//         name: 'Default',
//         importance: AndroidImportance.HIGH,
//         sound: 'default',
//       });
//     }
//   } catch (e) {
//     log('ensureNotificationsReady error:', e);
//   }
// }

// /**
//  * Display a local/system notification (used for foreground messages)
//  */
// async function displayLocal(remoteMessage) {
//   try {
//     await ensureNotificationsReady();

//     const type = remoteMessage?.data?.type;
//     const isChat = type === 'chat_message';

//     const title =
//       remoteMessage?.notification?.title ??
//       remoteMessage?.data?.title ??
//       (isChat ? 'New message 💬' : 'New notification');
//     const body =
//       remoteMessage?.notification?.body ??
//       remoteMessage?.data?.text ??
//       remoteMessage?.data?.body ??
//       (isChat ? 'You have a new chat message' : 'You have a new update');

//     await notifee.displayNotification({
//       title,
//       body,
//       data: remoteMessage?.data,
//       android: {
//         channelId: 'default',
//         // optional: if you set a custom small icon in android/app/src/main/res
//         // smallIcon: 'ic_notification',
//         pressAction: { id: 'default' },
//       },
//     });
//   } catch (e) {
//     log('displayLocal error:', e);
//   }
// }

// /**
//  * DB helpers
//  */
// async function doesTokenExist(userId, token) {
//   try {
//     const { data, error } = await supabase
//       .from('devices')
//       .select('id')
//       .eq('user_id', userId)
//       .eq('token', token)
//       .maybeSingle();

//     if (error) {
//       log('Token existence check error:', error);
//       return false;
//     }
//     return !!data;
//   } catch (e) {
//     log('doesTokenExist error:', e);
//     return false;
//   }
// }

// async function registerFcmTokenForUser() {
//   try {
//     const {
//       data: { user },
//     } = await supabase.auth.getUser();
//     if (!user) {
//       log('[App] No user, skipping FCM token registration.');
//       return;
//     }

//     await messaging().registerDeviceForRemoteMessages();
//     const token = await messaging().getToken();
//     log('[App] FCM token:', token);

//     if (!token) return;

//     const tokenExists = await doesTokenExist(user.id, token);
//     if (tokenExists) {
//       log('[App] Token already registered for user, skipping update');
//       return;
//     }

//     const { error } = await supabase.from('devices').upsert(
//       {
//         user_id: user.id,
//         token,
//         platform: Platform.OS,
//         updated_at: new Date().toISOString(),
//       },
//       { onConflict: ['user_id', 'token'] },
//     );

//     if (error) log('devices upsert error:', error);
//     else log('Device token upserted for user:', user.id);
//   } catch (e) {
//     log('[App] registerFcmTokenForUser error:', e);
//   }
// }

// /**
//  * Navigation on notification (optional)
//  */
// function handleNotificationNavigation(notificationData) {
//   if (!notificationData) return;
//   const { type, image_id, household_id } = notificationData;
//   log('Notification data for navigation:', { type, image_id, household_id });

//   // TODO: Use a navigation ref to navigate based on type/deep_link
//   // if (type === 'chat_message' && household_id) navRef.navigate('PrivateChat', { householdId: household_id });
// }

// const App = () => {
//   useEffect(() => {
//     let unsubForeground;
//     let unsubTokenRefresh;
//     let unsubNotificationOpened;
//     let appStateSubscription;

//     const init = async () => {
//       try {
//         await ensureNotificationsReady();

//         // Ask FCM permission (iOS; Android pre-13 not needed)
//         const authStatus = await messaging().requestPermission();
//         const enabled =
//           authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
//           authStatus === messaging.AuthorizationStatus.PROVISIONAL;
//         log('[App] messaging permission:', authStatus, 'enabled:', enabled);

//         // Initial token registration
//         await registerFcmTokenForUser();

//         // Listen for auth state changes (login/logout) and (re)register token
//         const {
//           data: { subscription },
//         } = supabase.auth.onAuthStateChange((_event, session) => {
//           if (session?.user) {
//             log('[App] Auth changed: user logged in, registering FCM token');
//             registerFcmTokenForUser();
//           } else {
//             log('[App] Auth changed: user logged out');
//           }
//         });

//         // Listen for token refresh
//         unsubTokenRefresh = messaging().onTokenRefresh(async newToken => {
//           log('[App] FCM token refreshed:', newToken);
//           await registerFcmTokenForUser();
//         });

//         // Foreground messages: show a local/system notification
//         unsubForeground = messaging().onMessage(async remoteMessage => {
//           log('[App] FCM foreground message:', remoteMessage);
//           await displayLocal(remoteMessage);
//         });

//         // App opened from background by tapping notification
//         unsubNotificationOpened = messaging().onNotificationOpenedApp(
//           remoteMessage => {
//             log(
//               '[App] Notification opened app from background:',
//               remoteMessage,
//             );
//             handleNotificationNavigation(remoteMessage?.data);
//           },
//         );

//         // App opened from quit state by tapping notification
//         messaging()
//           .getInitialNotification()
//           .then(remoteMessage => {
//             if (remoteMessage) {
//               log('[App] App opened by notification:', remoteMessage);
//               handleNotificationNavigation(remoteMessage?.data);
//             }
//           });

//         // Re-register token when app becomes active (optional)
//         appStateSubscription = AppState.addEventListener(
//           'change',
//           nextAppState => {
//             if (nextAppState === 'active') {
//               log('[App] App came to foreground, checking FCM token');
//               registerFcmTokenForUser();
//             }
//           },
//         );

//         return () => {
//           try {
//             subscription?.unsubscribe?.();
//           } catch {}
//         };
//       } catch (e) {
//         log('[App] Push init error:', e);
//       }
//     };

//     init();

//     return () => {
//       try {
//         unsubForeground && unsubForeground();
//         unsubTokenRefresh && unsubTokenRefresh();
//         unsubNotificationOpened && unsubNotificationOpened();
//         appStateSubscription && appStateSubscription.remove();
//       } catch (e) {
//         // ignore
//       }
//     };
//   }, []);

//   return (
//     <MenuProvider>
//       <ThemeProvider>
//         <NavigationContainer>
//           <StatusBar barStyle="light-content" backgroundColor="#121212" />
//           <AppNavigator />
//         </NavigationContainer>
//       </ThemeProvider>
//     </MenuProvider>
//   );
// };

// export default App;
