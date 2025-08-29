// AppNavigator.js - Clean and simple with proper tab bar
import React, { useEffect } from 'react';
import { ActivityIndicator, View, Platform } from 'react-native';
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
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#FFF5F8',
      }}
    >
      <Icon
        name="heart"
        size={50}
        color="#FF80AB"
        style={{ marginBottom: 20 }}
      />
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
            <View
              style={{
                alignItems: 'center',
                justifyContent: 'center',
                paddingTop: 2,
              }}
            >
              <Icon name={iconName} size={26} color={color} />
              {focused && (
                <View
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: color,
                    marginTop: 4,
                  }}
                />
              )}
            </View>
          );
        },
        tabBarActiveTintColor: '#FF80AB',
        tabBarInactiveTintColor: '#999',
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          position: 'absolute',
          left: 20,
          right: 20,
          bottom: Platform.OS === 'ios' ? 28 : 20,
          borderRadius: 25,
          backgroundColor: '#FFFFFF',
          height: Platform.OS === 'ios' ? 65 : 60,
          borderTopWidth: 0,
          paddingTop: 5,
          paddingBottom: Platform.OS === 'ios' ? 15 : 5,

          // Shadow for iOS
          shadowColor: '#000',
          shadowOpacity: 0.1,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 5 },

          // Shadow for Android
          elevation: 12,
        },
        tabBarHideOnKeyboard: true,
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
    screenOptions={{
      headerShown: false,
      animation: 'slide_from_right',
      gestureEnabled: true,
    }}
  >
    <Stack.Screen
      name="Gate"
      component={SessionGate}
      options={{ animation: 'fade' }}
    />
    <Stack.Screen
      name="ProfileSelector"
      component={ProfileSelectorScreen}
      options={{ animation: 'fade' }}
    />
    <Stack.Screen
      name="Auth"
      component={AuthScreen}
      options={{ animation: 'slide_from_bottom' }}
    />
    <Stack.Screen
      name="MainTabs"
      component={MainTabs}
      options={{ animation: 'fade' }}
    />
    <Stack.Screen name="DayGallery" component={DayGalleryScreen} />
    <Stack.Screen
      name="Profile"
      component={ProfileScreen}
      options={{ animation: 'slide_from_bottom' }}
    />
    <Stack.Screen name="SharedCalendar" component={SharedCalendarScreen} />
    <Stack.Screen
      name="ThemesStickers"
      component={ThemesStickersScreen}
      options={{ animation: 'slide_from_bottom' }}
    />
    <Stack.Screen name="PrivateChat" component={PrivateChatScreen} />
    <Stack.Screen
      name="PhotoVault"
      component={PhotoVaultScreen}
      options={{ animation: 'slide_from_bottom' }}
    />
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
// import ProfileSelectorScreen from '../screens/ProfileSelectorScreen';

// const Stack = createNativeStackNavigator();
// const Tab = createBottomTabNavigator();

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
//           if (route.name === 'Gallery')
//             iconName = focused ? 'images' : 'images-outline';
//           else if (route.name === 'Favorites')
//             iconName = focused ? 'heart' : 'heart-outline';
//           else if (route.name === 'Camera')
//             iconName = focused ? 'camera' : 'camera-outline';
//           else if (route.name === 'Chat')
//             iconName = focused ? 'chatbubbles' : 'chatbubbles-outline';
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
//           left: 20,
//           right: 20,
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
//       <Tab.Screen name="Favorites" component={FavoritesScreen} />
//       <Tab.Screen
//         name="Camera"
//         component={CameraScreen}
//         options={{ tabBarStyle: { display: 'none' } }}
//       />
//       <Tab.Screen
//         name="Chat"
//         component={PrivateChatScreen}
//         options={{ tabBarStyle: { display: 'none' } }}
//       />
//     </Tab.Navigator>
//   );
// }

// const AppNavigator = () => (
//   <Stack.Navigator
//     initialRouteName="Gate"
//     screenOptions={{ headerShown: false }}
//   >
//     <Stack.Screen name="Gate" component={SessionGate} />
//     <Stack.Screen name="ProfileSelector" component={ProfileSelectorScreen} />
//     <Stack.Screen name="Auth" component={AuthScreen} />
//     <Stack.Screen name="MainTabs" component={MainTabs} />
//     <Stack.Screen name="DayGallery" component={DayGalleryScreen} />
//     <Stack.Screen name="Profile" component={ProfileScreen} />
//     <Stack.Screen name="SharedCalendar" component={SharedCalendarScreen} />
//     <Stack.Screen name="ThemesStickers" component={ThemesStickersScreen} />
//     <Stack.Screen name="PrivateChat" component={PrivateChatScreen} />
//     <Stack.Screen name="PhotoVault" component={PhotoVaultScreen} />
//     <Stack.Screen name="Personalization" component={PersonalizationScreen} />
//   </Stack.Navigator>
// );

// export default AppNavigator;
