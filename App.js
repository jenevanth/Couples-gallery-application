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
  // Android 13+ runtime permission
  await notifee.requestPermission();

  // Create the "default" channel to match FCM payload channel_id
  await notifee.createChannel({
    id: 'default',
    name: 'Default',
    importance: AndroidImportance.HIGH,
    sound: 'default',
  });
}

/**
 * Display a local/system notification (used for foreground messages)
 */
async function displayLocal(remoteMessage) {
  await ensureNotificationsReady();

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
      // If you don't have a custom small icon yet, you can comment this out
      // and Android will fall back to ic_launcher.
      smallIcon: 'ic_notification',
      pressAction: { id: 'default' },
    },
  });
}

/**
 * DB helpers
 */
async function doesTokenExist(userId, token) {
  try {
    const { data, error } = await supabase
      .from('devices')
      .select()
      .eq('user_id', userId)
      .eq('token', token)
      .maybeSingle();

    if (error) {
      log('Token existence check error:', error);
      return false;
    }
    return !!data;
  } catch (e) {
    log('doesTokenExist error:', e);
    return false;
  }
}

async function registerFcmTokenForUser() {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      log('[App] No user, skipping FCM token registration.');
      return;
    }

    await messaging().registerDeviceForRemoteMessages();
    const token = await messaging().getToken();
    log('[App] FCM token:', token);

    if (!token) return;

    const tokenExists = await doesTokenExist(user.id, token);
    if (tokenExists) {
      log('Token already registered for user, skipping update');
      return;
    }

    const { error } = await supabase.from('devices').upsert(
      {
        user_id: user.id,
        token,
        platform: Platform.OS,
        updated_at: new Date().toISOString(),
      },
      { onConflict: ['user_id', 'token'] },
    );

    if (error) log('devices upsert error:', error);
    else log('Device token upserted for user:', user.id);
  } catch (e) {
    log('[App] registerFcmTokenForUser error:', e);
  }
}

/**
 * Navigation on notification
 */
function handleNotificationNavigation(notificationData) {
  if (!notificationData) return;
  const { type, image_id, user_id } = notificationData;
  log('Notification data for navigation:', { type, image_id, user_id });

  // TODO: Use a navigation ref to navigate based on type
  if (type === 'new_image') {
    log('Would navigate to image:', image_id);
  }
}

const App = () => {
  useEffect(() => {
    let unsubForeground = null;
    let unsubTokenRefresh = null;
    let unsubNotificationOpened = null;
    let authListener = null;

    const init = async () => {
      try {
        await ensureNotificationsReady();

        const authStatus = await messaging().requestPermission();
        const enabled =
          authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
          authStatus === messaging.AuthorizationStatus.PROVISIONAL;
        log('messaging permission:', authStatus, 'enabled:', enabled);

        // Initial token registration
        await registerFcmTokenForUser();

        // Listen for auth state changes (login/logout)
        authListener = supabase.auth.onAuthStateChange((_event, session) => {
          if (session?.user) {
            log('[App] Auth changed: user logged in, registering FCM token');
            registerFcmTokenForUser();
          } else {
            log('[App] Auth changed: user logged out');
          }
        });

        // Listen for token refresh
        unsubTokenRefresh = messaging().onTokenRefresh(async newToken => {
          log('FCM token refreshed:', newToken);
          await registerFcmTokenForUser();
        });

        // Foreground messages: show a local/system notification
        unsubForeground = messaging().onMessage(async remoteMessage => {
          log('FCM foreground message:', remoteMessage);
          await displayLocal(remoteMessage);
        });

        // App opened from background by tapping notification
        unsubNotificationOpened = messaging().onNotificationOpenedApp(
          remoteMessage => {
            log('Notification opened app from background:', remoteMessage);
            handleNotificationNavigation(remoteMessage?.data);
          },
        );

        // App opened from quit state by tapping notification
        messaging()
          .getInitialNotification()
          .then(remoteMessage => {
            if (remoteMessage) {
              log('App opened by notification:', remoteMessage);
              handleNotificationNavigation(remoteMessage?.data);
            }
          });

        // Re-register token when app becomes active (optional)
        const appStateSubscription = AppState.addEventListener(
          'change',
          nextAppState => {
            if (nextAppState === 'active') {
              log('App came to foreground, checking FCM token');
              registerFcmTokenForUser();
            }
          },
        );

        return () => {
          appStateSubscription.remove();
        };
      } catch (e) {
        log('Push init error:', e);
      }
    };

    init();

    return () => {
      if (unsubForeground) unsubForeground();
      if (unsubTokenRefresh) unsubTokenRefresh();
      if (unsubNotificationOpened) unsubNotificationOpened();
      if (authListener && typeof authListener.unsubscribe === 'function') {
        authListener.unsubscribe();
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

// import React, { useEffect } from 'react';
// import {
//   StatusBar,
//   Platform,
//   PermissionsAndroid,
//   Alert,
//   AppState,
// } from 'react-native';
// import { MenuProvider } from 'react-native-popup-menu';
// import { NavigationContainer } from '@react-navigation/native';
// import AppNavigator from './src/navigation/AppNavigator';
// import { ThemeProvider } from './src/theme/ThemeContext';
// import {
//   getMessaging,
//   getToken,
//   onMessage,
//   onTokenRefresh,
//   setBackgroundMessageHandler,
//   getInitialNotification,
//   onNotificationOpenedApp,
// } from '@react-native-firebase/messaging';
// import { supabase } from './src/services/supabase';

// const messaging = getMessaging();
// const log = (...a) => console.log('[App]', ...a);

// async function ensureAndroid13NotifPermission() {
//   if (Platform.OS !== 'android') return true;
//   if (Platform.Version < 33) return true;
//   try {
//     const granted = await PermissionsAndroid.request(
//       PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
//     );
//     log('POST_NOTIFICATIONS ->', granted);
//     return granted === PermissionsAndroid.RESULTS.GRANTED;
//   } catch (e) {
//     log('POST_NOTIFICATIONS error:', e);
//     return false;
//   }
// }

// // Check if token already exists for user
// async function doesTokenExist(userId, token) {
//   try {
//     const { data, error } = await supabase
//       .from('devices')
//       .select()
//       .eq('user_id', userId)
//       .eq('token', token)
//       .single();

//     if (error && error.code !== 'PGRST116') {
//       // PGRST116 = no rows found
//       log('Token existence check error:', error);
//       return false;
//     }

//     return !!data;
//   } catch (e) {
//     log('doesTokenExist error:', e);
//     return false;
//   }
// }

// // Clean up stale/unregistered tokens
// async function cleanupStaleTokens() {
//   try {
//     const { data: devices, error } = await supabase
//       .from('devices')
//       .select('id, token, user_id, updated_at');

//     if (error) {
//       log('Cleanup fetch error:', error);
//       return;
//     }

//     // In a real app, you might want to periodically check token validity
//     // or handle this when you get UNREGISTERED errors from FCM
//     log(`Found ${devices?.length || 0} devices to potentially clean up`);
//   } catch (e) {
//     log('Token cleanup error:', e);
//   }
// }

// // Register or update the FCM token for the current user
// async function registerFcmTokenForUser() {
//   try {
//     const {
//       data: { user },
//     } = await supabase.auth.getUser();
//     if (!user) {
//       log('[App] No user, skipping FCM token registration.');
//       return;
//     }

//     const token = await getToken(messaging);
//     log('[App] FCM token:', token);

//     if (!token) {
//       log('No FCM token available');
//       return;
//     }

//     // Check if token already exists for this user
//     const tokenExists = await doesTokenExist(user.id, token);
//     if (tokenExists) {
//       log('Token already registered for user, skipping update');
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

//     if (error) {
//       log('devices upsert error:', error);
//     } else {
//       log('Device token upserted for user:', user.id);
//     }
//   } catch (e) {
//     log('[App] registerFcmTokenForUser error:', e);
//   }
// }

// // Handle notification navigation
// function handleNotificationNavigation(notificationData) {
//   if (!notificationData) return;

//   // Example: Navigate to specific screen based on notification type
//   const { type, image_id, user_id } = notificationData;

//   log('Notification data for navigation:', { type, image_id, user_id });

//   // You can use a navigation ref or context to navigate
//   // For now, just log the potential navigation
//   if (type === 'new_image') {
//     log('Would navigate to image:', image_id);
//   }
// }

// const App = () => {
//   useEffect(() => {
//     let unsubForeground = null;
//     let unsubTokenRefresh = null;
//     let unsubNotificationOpened = null;
//     let authListener = null;

//     const init = async () => {
//       try {
//         await ensureAndroid13NotifPermission();

//         const authStatus = await messaging().requestPermission();
//         const enabled =
//           authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
//           authStatus === messaging.AuthorizationStatus.PROVISIONAL;
//         log('messaging permission:', authStatus, 'enabled:', enabled);

//         // Initial token registration
//         await registerFcmTokenForUser();

//         // Clean up stale tokens periodically (every 24 hours)
//         cleanupStaleTokens();
//         const cleanupInterval = setInterval(
//           cleanupStaleTokens,
//           24 * 60 * 60 * 1000,
//         );

//         // Listen for auth state changes (login/logout)
//         authListener = supabase.auth.onAuthStateChange((event, session) => {
//           if (session?.user) {
//             log(
//               '[App] Auth state changed: user logged in, registering FCM token',
//             );
//             registerFcmTokenForUser();
//           } else {
//             log('[App] Auth state changed: user logged out');
//           }
//         });

//         // Listen for token refresh
//         unsubTokenRefresh = onTokenRefresh(messaging, async newToken => {
//           log('FCM token refreshed:', newToken);
//           await registerFcmTokenForUser();
//         });

//         // Handle background messages (app in background)
//         setBackgroundMessageHandler(messaging, async remoteMessage => {
//           log('FCM background message:', remoteMessage);
//           // System notification will be shown automatically
//           // You can add custom processing here if needed

//           // Return a promise if you do async work
//           return Promise.resolve();
//         });

//         // Check if app was opened by a notification (cold start)
//         getInitialNotification(messaging).then(remoteMessage => {
//           if (remoteMessage) {
//             log('App opened by notification:', remoteMessage);
//             handleNotificationNavigation(remoteMessage.data);
//           }
//         });

//         // Handle notification opened when app is in background
//         unsubNotificationOpened = onNotificationOpenedApp(
//           messaging,
//           remoteMessage => {
//             log('Notification opened app from background:', remoteMessage);
//             handleNotificationNavigation(remoteMessage.data);
//           },
//         );

//         // Foreground messages: show system-style alert
//         // In your App.js onMessage handler
//         unsubForeground = onMessage(messaging, async msg => {
//           log('FCM foreground message:', msg);

//           // Check if we should show notification even in foreground
//           const showInForeground = msg?.data?.show_in_foreground === 'true';

//           if (showInForeground) {
//             // Show system-style alert
//             const title =
//               msg?.notification?.title || msg?.data?.title || 'New Photo!';
//             const body =
//               msg?.notification?.body ||
//               msg?.data?.body ||
//               'Your gallery has been updated';

//             Alert.alert(title, body, [
//               {
//                 text: 'View',
//                 onPress: () => handleNotificationNavigation(msg.data),
//               },
//               {
//                 text: 'Dismiss',
//                 style: 'cancel',
//               },
//             ]);
//           } else {
//             log('Notification suppressed in foreground');
//           }
//         });

//         // Re-register token when app comes to foreground
//         const appStateSubscription = AppState.addEventListener(
//           'change',
//           nextAppState => {
//             if (nextAppState === 'active') {
//               log('App came to foreground, checking FCM token');
//               registerFcmTokenForUser();
//             }
//           },
//         );

//         return () => {
//           clearInterval(cleanupInterval);
//           appStateSubscription.remove();
//         };
//       } catch (e) {
//         log('Push init error:', e);
//       }
//     };

//     init();

//     return () => {
//       if (unsubForeground) unsubForeground();
//       if (unsubTokenRefresh) unsubTokenRefresh();
//       if (unsubNotificationOpened) unsubNotificationOpened();
//       if (authListener && typeof authListener.unsubscribe === 'function') {
//         authListener.unsubscribe();
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

// import React, { useEffect } from 'react';
// import { StatusBar, Platform } from 'react-native';
// import { MenuProvider } from 'react-native-popup-menu';
// import { NavigationContainer } from '@react-navigation/native';
// import AppNavigator from './src/navigation/AppNavigator';
// import { ThemeProvider } from './src/theme/ThemeContext';
// import messaging from '@react-native-firebase/messaging';
// import { supabase } from './src/services/supabase';
// console.log('[App.js] supabase:', supabase);

// const App = () => {
//   useEffect(() => {
//     const registerDevice = async () => {
//       try {
//         // Request notification permission
//         const authStatus = await messaging().requestPermission();
//         const enabled =
//           authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
//           authStatus === messaging.AuthorizationStatus.PROVISIONAL;
//         if (!enabled) {
//           console.log('[Push] Notification permission denied');
//           return;
//         }

//         // Get FCM token
//         const token = await messaging().getToken();
//         console.log('[Push] FCM token:', token);

//         // Get user
//         const {
//           data: { user },
//         } = await supabase.auth.getUser();
//         if (!user) return;

//         // Upsert device token to Supabase
//         await supabase.from('devices').upsert({
//           user_id: user.id,
//           token,
//           platform: Platform.OS,
//         });
//         console.log('[Push] Device token registered in Supabase');
//       } catch (e) {
//         console.log('[Push] Registration error:', e);
//       }
//     };

//     registerDevice();
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
