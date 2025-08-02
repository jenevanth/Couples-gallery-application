import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/Ionicons';

import ProfileSelectorScreen from '../screens/ProfileSelectorScreen';
import AuthScreen from '../screens/AuthScreen';
import GalleryScreen from '../screens/GalleryScreen';
import DayGalleryScreen from '../screens/DayGalleryScreen';
import FavoritesScreen from '../screens/FavoritesScreen';
import CameraScreen from '../screens/CameraScreen';
import ProfileScreen from '../screens/ProfileScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs() {
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
        tabBarShowLabel: true, // <-- THIS REMOVES LABELS
        tabBarStyle: {
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 24,
          borderRadius: 24,
          backgroundColor: '#fff',
          elevation: 10,
          height: 70,
          borderTopWidth: 0,
          shadowColor: '#000',
          shadowOpacity: 0.1,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
        },
      })}
    >
      <Tab.Screen name="Gallery" component={GalleryScreen} />
      <Tab.Screen name="Favorites" component={FavoritesScreen} />
      <Tab.Screen name="Camera" component={CameraScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

const AppNavigator = () => (
  <Stack.Navigator
    initialRouteName="ProfileSelector"
    screenOptions={{ headerShown: false }}
  >
    <Stack.Screen name="ProfileSelector" component={ProfileSelectorScreen} />
    <Stack.Screen name="Auth" component={AuthScreen} />
    <Stack.Screen name="MainTabs" component={MainTabs} />
    <Stack.Screen name="DayGallery" component={DayGalleryScreen} />
  </Stack.Navigator>
);

export default AppNavigator;
