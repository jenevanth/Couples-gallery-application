import React, { useEffect } from 'react';
import { StatusBar, Platform } from 'react-native';
import { MenuProvider } from 'react-native-popup-menu';
import { NavigationContainer } from '@react-navigation/native';
import AppNavigator from './src/navigation/AppNavigator';
import { ThemeProvider } from './src/theme/ThemeContext';
import messaging from '@react-native-firebase/messaging';
import { supabase } from './src/services/supabase';
console.log('[App.js] supabase:', supabase);

const App = () => {
  useEffect(() => {
    const registerDevice = async () => {
      try {
        // Request notification permission
        const authStatus = await messaging().requestPermission();
        const enabled =
          authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
          authStatus === messaging.AuthorizationStatus.PROVISIONAL;
        if (!enabled) {
          console.log('[Push] Notification permission denied');
          return;
        }

        // Get FCM token
        const token = await messaging().getToken();
        console.log('[Push] FCM token:', token);

        // Get user
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        // Upsert device token to Supabase
        await supabase.from('devices').upsert({
          user_id: user.id,
          token,
          platform: Platform.OS,
        });
        console.log('[Push] Device token registered in Supabase');
      } catch (e) {
        console.log('[Push] Registration error:', e);
      }
    };

    registerDevice();
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

// /**
//  * App.js
//  * This is the root of the application.
//  * It imports the necessary polyfill for Supabase to work correctly
//  * and then wraps the entire app in the ThemeProvider and Navigation.
//  */
// import 'react-native-url-polyfill/auto'; // MUST BE THE FIRST IMPORT
// import { MenuProvider } from 'react-native-popup-menu';
// import React from 'react';
// import { StatusBar } from 'react-native';
// import { NavigationContainer } from '@react-navigation/native';
// import AppNavigator from './src/navigation/AppNavigator';
// import { ThemeProvider } from './src/theme/ThemeContext';

// const App = () => {
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
