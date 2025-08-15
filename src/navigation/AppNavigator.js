import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/Ionicons';

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

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ color, focused }) => {
          let iconName;
          if (route.name === 'Gallery') iconName = 'images-outline';
          else if (route.name === 'Favorites') iconName = 'heart-outline';
          else if (route.name === 'Camera') iconName = 'camera-outline';
          else if (route.name === 'Personalization')
            iconName = 'color-palette-outline';
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
          left: 16,
          right: 16,
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
          alignItems: 'center', // <-- Center icons horizontally
          justifyContent: 'center', // <-- Center icons vertically
          paddingTop: 4, // <-- Fine-tune vertical position
          paddingBottom: 4,
        },
      })}
    >
      <Tab.Screen name="Gallery" component={GalleryScreen} />
      <Tab.Screen name="Favorites" component={FavoritesScreen} />
      <Tab.Screen name="Camera" component={CameraScreen} />
      <Tab.Screen name="Personalization" component={PersonalizationScreen} />
    </Tab.Navigator>
  );
}

const AppNavigator = () => (
  <Stack.Navigator
    initialRouteName="Auth"
    screenOptions={{ headerShown: false }}
  >
    <Stack.Screen name="Auth" component={AuthScreen} />
    <Stack.Screen name="MainTabs" component={MainTabs} />
    <Stack.Screen name="DayGallery" component={DayGalleryScreen} />
    <Stack.Screen name="Profile" component={ProfileScreen} />
    <Stack.Screen name="SharedCalendar" component={SharedCalendarScreen} />
    <Stack.Screen name="ThemesStickers" component={ThemesStickersScreen} />
    <Stack.Screen name="PrivateChat" component={PrivateChatScreen} />
    <Stack.Screen name="PhotoVault" component={PhotoVaultScreen} />
  </Stack.Navigator>
);

export default AppNavigator;
