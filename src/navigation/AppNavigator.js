import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import GalleryScreen from '../screens/GalleryScreen';
import FavoritesScreen from '../screens/FavoritesScreen';
import CameraScreen from '../screens/CameraScreen';
import ProfileScreen from '../screens/ProfileScreen';
import Icon from 'react-native-vector-icons/Ionicons';

const Tab = createBottomTabNavigator();

export default function AppNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ color, size }) => {
          let iconName;
          if (route.name === 'Gallery') iconName = 'images-outline';
          else if (route.name === 'Favorites') iconName = 'heart-outline';
          else if (route.name === 'Camera') iconName = 'camera-outline';
          else if (route.name === 'Profile') iconName = 'person-outline';
          return <Icon name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#FF80AB',
        tabBarInactiveTintColor: '#aaa',
        headerShown: false,
      })}
    >
      <Tab.Screen name="Gallery" component={GalleryScreen} />
      <Tab.Screen name="Favorites" component={FavoritesScreen} />
      <Tab.Screen name="Camera" component={CameraScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

// /**
//  * src/navigation/AppNavigator.js
//  * This file defines the navigation structure of the app using React Navigation.
//  * It sets up a "stack" of screens that the user can move between.
//  */
// import React from 'react';
// import { createNativeStackNavigator } from '@react-navigation/native-stack';

// // Import all the screens
// import ProfileSelectorScreen from '../screens/ProfileSelectorScreen';
// import AuthScreen from '../screens/AuthScreen';
// import GalleryScreen from '../screens/GalleryScreen';

// const Stack = createNativeStackNavigator();

// const AppNavigator = () => {
//   return (
//     <Stack.Navigator
//       // Start with the ProfileSelectorScreen
//       initialRouteName="ProfileSelector"
//       // Hide the default header to use our own custom designs
//       screenOptions={{ headerShown: false }}
//     >
//       <Stack.Screen name="ProfileSelector" component={ProfileSelectorScreen} />
//       <Stack.Screen name="Auth" component={AuthScreen} />
//       <Stack.Screen name="Gallery" component={GalleryScreen} />
//     </Stack.Navigator>
//   );
// };

// export default AppNavigator;
