import React, { useEffect } from 'react';
import { StatusBar, Platform, PermissionsAndroid, Alert } from 'react-native';
import { MenuProvider } from 'react-native-popup-menu';
import { NavigationContainer } from '@react-navigation/native';
import AppNavigator from './src/navigation/AppNavigator';
import { ThemeProvider } from './src/theme/ThemeContext';
import messaging from '@react-native-firebase/messaging';
import { supabase } from './src/services/supabase';

const log = (...a) => console.log('[App]', ...a);

async function ensureAndroid13NotifPermission() {
  if (Platform.OS !== 'android') return true;
  if (Platform.Version < 33) return true;
  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    log('POST_NOTIFICATIONS ->', granted);
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch (e) {
    log('POST_NOTIFICATIONS error:', e);
    return false;
  }
}

// Register or update the FCM token for the current user
async function registerFcmTokenForUser() {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      log('[App] No user, skipping FCM token registration.');
      return;
    }
    const token = await messaging().getToken();
    log('[App] FCM token:', token);
    if (token) {
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
    }
  } catch (e) {
    log('[App] registerFcmTokenForUser error:', e);
  }
}

const App = () => {
  useEffect(() => {
    let unsub = null;
    let authListener = null;

    const init = async () => {
      try {
        await ensureAndroid13NotifPermission();
        const authStatus = await messaging().requestPermission();
        const enabled =
          authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
          authStatus === messaging.AuthorizationStatus.PROVISIONAL;
        log('messaging permission:', authStatus, 'enabled:', enabled);

        // Register token if already logged in
        await registerFcmTokenForUser();

        // Listen for auth state changes (login/logout)
        authListener = supabase.auth.onAuthStateChange((event, session) => {
          if (session?.user) {
            log(
              '[App] Auth state changed: user logged in, registering FCM token',
            );
            registerFcmTokenForUser();
          } else {
            log('[App] Auth state changed: user logged out');
          }
        });

        // Listen for token refresh
        messaging().onTokenRefresh(async newToken => {
          log('FCM token refreshed:', newToken);
          await registerFcmTokenForUser();
        });

        // Foreground messages: show an Alert so you actually see them while testing
        unsub = messaging().onMessage(async msg => {
          log('FCM foreground message:', msg);
          const title =
            msg?.notification?.title || msg?.data?.title || 'New item';
          const body =
            msg?.notification?.body ||
            msg?.data?.body ||
            JSON.stringify(msg?.data || {});
          Alert.alert(title, body);
        });
      } catch (e) {
        log('Push init error:', e);
      }
    };

    init();

    return () => {
      if (unsub) unsub();
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
