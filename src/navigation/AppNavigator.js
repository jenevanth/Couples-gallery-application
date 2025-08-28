import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/Ionicons';
import { supabase } from '../services/supabase';

import AuthScreen from '../screens/AuthScreen';
import GalleryScreen from '../screens/GalleryScreen';
import DayGalleryScreen from '../screens/DayGalleryScreen';
import FavoritesScreen from '../screens/FavoritesScreen';
import CameraScreen from '../screens/CameraScreen';
import PersonalizationScreen from '../screens/PersonalizationScreen';
import ProfileScreen from '../screens/ProfileScreen';
import SharedCalendarScreen from '../screens/SharedCalendarScreen';
import ThemesStickersScreen from '../screens/ThemesStickersScreen';
import PrivateChatScreen from '../screens/PrivateChatScreen';
import PhotoVaultScreen from '../screens/PhotoVaultScreen';
import ProfileSelectorScreen from '../screens/ProfileSelectorScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const SessionGate = ({ navigation }) => {
  useEffect(() => {
    let mounted = true;

    const routeTo = name => {
      if (!mounted) return;
      console.log('[Gate] routeTo ->', name);
      navigation.reset({ index: 0, routes: [{ name }] });
    };

    const check = async () => {
      try {
        console.log('[Gate] checking session...');
        const {
          data: { session },
        } = await supabase.auth.getSession();
        console.log('[Gate] session?', !!session);
        if (session) routeTo('MainTabs');
        else routeTo('ProfileSelector');
      } catch (e) {
        console.log('[Gate] check error:', e);
        routeTo('ProfileSelector');
      }
    };
    check();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[Gate] auth change event:', event, 'session?', !!session);
      if (session) routeTo('MainTabs');
      else routeTo('ProfileSelector');
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, [navigation]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator size="large" color="#FF80AB" />
    </View>
  );
};

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ color, focused }) => {
          let iconName;
          if (route.name === 'Gallery')
            iconName = focused ? 'images' : 'images-outline';
          else if (route.name === 'Favorites')
            iconName = focused ? 'heart' : 'heart-outline';
          else if (route.name === 'Camera')
            iconName = focused ? 'camera' : 'camera-outline';
          else if (route.name === 'Chat')
            iconName = focused ? 'chatbubbles' : 'chatbubbles-outline';
          return (
            <Icon name={iconName} size={focused ? 30 : 30} color={color} />
          );
        },
        tabBarActiveTintColor: '#FF80AB',
        tabBarInactiveTintColor: '#aaa',
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          position: 'absolute',
          left: 20,
          right: 20,
          bottom: 24,
          borderRadius: 24,
          backgroundColor: '#fff',
          elevation: 10,
          height: 58,
          borderTopWidth: 0,
          shadowColor: '#000',
          shadowOpacity: 0.1,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          alignItems: 'center',
          justifyContent: 'center',
          paddingTop: 4,
          paddingBottom: 4,
        },
      })}
    >
      <Tab.Screen name="Gallery" component={GalleryScreen} />
      <Tab.Screen name="Favorites" component={FavoritesScreen} />
      <Tab.Screen
        name="Camera"
        component={CameraScreen}
        options={{ tabBarStyle: { display: 'none' } }}
      />
      <Tab.Screen
        name="Chat"
        component={PrivateChatScreen}
        options={{ tabBarStyle: { display: 'none' } }}
      />
    </Tab.Navigator>
  );
}

const AppNavigator = () => (
  <Stack.Navigator
    initialRouteName="Gate"
    screenOptions={{ headerShown: false }}
  >
    <Stack.Screen name="Gate" component={SessionGate} />
    <Stack.Screen name="ProfileSelector" component={ProfileSelectorScreen} />
    <Stack.Screen name="Auth" component={AuthScreen} />
    <Stack.Screen name="MainTabs" component={MainTabs} />
    <Stack.Screen name="DayGallery" component={DayGalleryScreen} />
    <Stack.Screen name="Profile" component={ProfileScreen} />
    <Stack.Screen name="SharedCalendar" component={SharedCalendarScreen} />
    <Stack.Screen name="ThemesStickers" component={ThemesStickersScreen} />
    <Stack.Screen name="PrivateChat" component={PrivateChatScreen} />
    <Stack.Screen name="PhotoVault" component={PhotoVaultScreen} />
    <Stack.Screen name="Personalization" component={PersonalizationScreen} />
  </Stack.Navigator>
);

export default AppNavigator;

// import React, { useEffect } from 'react';
// import { ActivityIndicator, View } from 'react-native';
// import { createNativeStackNavigator } from '@react-navigation/native-stack';
// import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
// import Icon from 'react-native-vector-icons/Ionicons';
// import { supabase } from '../services/supabase';

// import AuthScreen from '../screens/AuthScreen';
// import GalleryScreen from '../screens/GalleryScreen';
// import DayGalleryScreen from '../screens/DayGalleryScreen';
// import FavoritesScreen from '../screens/FavoritesScreen';
// import CameraScreen from '../screens/CameraScreen';
// import PersonalizationScreen from '../screens/PersonalizationScreen';
// import ProfileScreen from '../screens/ProfileScreen';
// import SharedCalendarScreen from '../screens/SharedCalendarScreen';
// import ThemesStickersScreen from '../screens/ThemesStickersScreen';
// import PrivateChatScreen from '../screens/PrivateChatScreen';
// import PhotoVaultScreen from '../screens/PhotoVaultScreen';

// // Make sure this exists (rename if your file name differs)
// import ProfileSelectorScreen from '../screens/ProfileSelectorScreen';

// const Stack = createNativeStackNavigator();
// const Tab = createBottomTabNavigator();

// // Decides route at launch and on auth changes
// const SessionGate = ({ navigation }) => {
//   useEffect(() => {
//     let mounted = true;

//     const routeTo = name => {
//       if (!mounted) return;
//       console.log('[Gate] routeTo ->', name);
//       navigation.reset({ index: 0, routes: [{ name }] });
//     };

//     const check = async () => {
//       try {
//         console.log('[Gate] checking session...');
//         const {
//           data: { session },
//         } = await supabase.auth.getSession();
//         console.log('[Gate] session?', !!session);
//         if (session) routeTo('MainTabs');
//         else routeTo('ProfileSelector');
//       } catch (e) {
//         console.log('[Gate] check error:', e);
//         routeTo('ProfileSelector');
//       }
//     };
//     check();

//     // Listen to sign-in/sign-out
//     const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
//       console.log('[Gate] auth change event:', event, 'session?', !!session);
//       if (session) routeTo('MainTabs');
//       else routeTo('ProfileSelector');
//     });

//     return () => {
//       mounted = false;
//       sub?.subscription?.unsubscribe?.();
//     };
//   }, [navigation]);

//   return (
//     <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
//       <ActivityIndicator size="large" color="#FF80AB" />
//     </View>
//   );
// };

// function MainTabs() {
//   return (
//     <Tab.Navigator
//       screenOptions={({ route }) => ({
//         tabBarIcon: ({ color, focused }) => {
//           let iconName;
//           if (route.name === 'Gallery') iconName = 'images-outline';
//           else if (route.name === 'Favorites') iconName = 'heart-outline';
//           else if (route.name === 'Camera') iconName = 'camera-outline';
//           else if (route.name === 'Personalization')
//             iconName = 'color-palette-outline';
//           return (
//             <Icon name={iconName} size={focused ? 30 : 30} color={color} />
//           );
//         },
//         tabBarActiveTintColor: '#FF80AB',
//         tabBarInactiveTintColor: '#aaa',
//         headerShown: false,
//         tabBarShowLabel: false,
//         tabBarStyle: {
//           position: 'absolute',
//           left: 18,
//           right: 18,
//           bottom: 24,
//           borderRadius: 24,
//           backgroundColor: '#fff',
//           elevation: 10,
//           height: 58,
//           borderTopWidth: 0,
//           shadowColor: '#000',
//           shadowOpacity: 0.1,
//           shadowRadius: 8,
//           shadowOffset: { width: 0, height: 4 },
//           alignItems: 'center',
//           justifyContent: 'center',
//           paddingTop: 4,
//           paddingBottom: 4,
//         },
//       })}
//     >
//       <Tab.Screen name="Gallery" component={GalleryScreen} />
//       {/* If you want these hidden while focused, keep display:none.
//          Remove tabBarStyle below if you prefer to keep the tab bar visible. */}
//       <Tab.Screen name="Favorites" component={FavoritesScreen} />
//       <Tab.Screen
//         name="Camera"
//         component={CameraScreen}
//         options={{ tabBarStyle: { display: 'none' } }}
//       />
//       <Tab.Screen name="Personalization" component={PersonalizationScreen} />
//     </Tab.Navigator>
//   );
// }

// const AppNavigator = () => (
//   <Stack.Navigator
//     initialRouteName="Gate"
//     screenOptions={{ headerShown: false }}
//   >
//     {/* Gate decides: ProfileSelector vs MainTabs */}
//     <Stack.Screen name="Gate" component={SessionGate} />

//     {/* First screen on fresh app or after sign-out */}
//     <Stack.Screen name="ProfileSelector" component={ProfileSelectorScreen} />

//     {/* Keep Auth only if you still need a dedicated sign-in UI */}
//     <Stack.Screen name="Auth" component={AuthScreen} />

//     {/* Main app */}
//     <Stack.Screen name="MainTabs" component={MainTabs} />
//     <Stack.Screen name="DayGallery" component={DayGalleryScreen} />
//     <Stack.Screen name="Profile" component={ProfileScreen} />
//     <Stack.Screen name="SharedCalendar" component={SharedCalendarScreen} />
//     <Stack.Screen name="ThemesStickers" component={ThemesStickersScreen} />
//     <Stack.Screen name="PrivateChat" component={PrivateChatScreen} />
//     <Stack.Screen name="PhotoVault" component={PhotoVaultScreen} />
//   </Stack.Navigator>
// );

// export default AppNavigator;
