// AppNavigator.js - Fixed with conditional tab bar hiding, no notification badge,
// and longer SessionGate animation via minimum display time

import React, { useEffect, useState, useRef } from 'react';
import {
  ActivityIndicator,
  View,
  Platform,
  Animated,
  Text,
  TouchableOpacity,
  Dimensions,
  StyleSheet,
} from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/Ionicons';
import LinearGradient from 'react-native-linear-gradient';
import { supabase } from '../services/supabase';
import { useTheme } from '../theme/ThemeContext';

// Default colors fallback if COLORS is not defined
const DEFAULT_COLORS = {
  blue: {
    primary: '#4A90E2',
    secondary: '#5CA0F2',
    tertiary: '#6CB0FF',
    background: '#F0F8FF',
  },
  pink: {
    primary: '#FF6B9D',
    secondary: '#FF8E9E',
    tertiary: '#FFB1B3',
    background: '#FFF0F5',
  },
};

// Import COLORS with fallback
let COLORS;
try {
  // eslint-disable-next-line global-require
  COLORS = require('../theme/colors').COLORS || DEFAULT_COLORS;
} catch (e) {
  console.log('Using default colors');
  COLORS = DEFAULT_COLORS;
}

// Import screens
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

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Helper function to get safe colors (fallback when theme not available)
const getSafeColors = (profile = 'me') => {
  const colorSet =
    (profile === 'me' ? COLORS?.blue : COLORS?.pink) || DEFAULT_COLORS.blue;
  return {
    primary: colorSet.primary || DEFAULT_COLORS.blue.primary,
    secondary: colorSet.secondary || DEFAULT_COLORS.blue.secondary,
    tertiary: colorSet.tertiary || DEFAULT_COLORS.blue.tertiary,
    background: colorSet.background || DEFAULT_COLORS.blue.background,
    gradient: [
      colorSet.primary || DEFAULT_COLORS.blue.primary,
      colorSet.secondary || DEFAULT_COLORS.blue.secondary,
    ],
  };
};

// Helper to return theme-aware colors but fallback to profile-safe colors
const getColorsForProfile = (profile = 'me', theme) => {
  if (theme?.name) {
    const c =
      theme.colors ||
      (profile === 'me' ? COLORS?.blue : COLORS?.pink) ||
      DEFAULT_COLORS.blue;
    return {
      primary: c.primary || DEFAULT_COLORS.blue.primary,
      secondary: c.secondary || DEFAULT_COLORS.blue.secondary,
      tertiary:
        c.accent ||
        c.tertiary ||
        COLORS?.shared?.purple ||
        DEFAULT_COLORS.blue.tertiary,
      background: c.ultraLight || c.light || DEFAULT_COLORS.blue.background,
      gradient:
        Array.isArray(theme.gradient) && theme.gradient.length > 0
          ? theme.gradient
          : [
              c.primary || DEFAULT_COLORS.blue.primary,
              c.secondary || DEFAULT_COLORS.blue.secondary,
            ],
    };
  }
  return getSafeColors(profile);
};

// Animated Tab Icon Component (no notification badge, no profile indicator)
const TabIcon = ({ focused, iconName, color, profile }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const { theme } = useTheme?.();

  useEffect(() => {
    if (focused) {
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1.2,
          friction: 3,
          useNativeDriver: true,
        }),
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => {
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 3,
          useNativeDriver: true,
        }).start();
      });
    } else {
      Animated.parallel([
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(rotateAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [focused, rotateAnim, scaleAnim]);

  const profileColors = getColorsForProfile(profile, theme);

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={{
          transform: [
            { scale: scaleAnim },
            {
              rotate: rotateAnim.interpolate({
                inputRange: [0, 1],
                outputRange: ['0deg', '360deg'],
              }),
            },
          ],
        }}
      >
        {focused ? (
          <LinearGradient
            colors={profileColors.gradient}
            style={styles.focusedIconContainer}
          >
            <Icon name={iconName} size={24} color="#fff" />
          </LinearGradient>
        ) : (
          <View style={styles.unfocusedIconContainer}>
            <Icon name={iconName} size={26} color={color} />
          </View>
        )}
      </Animated.View>
    </View>
  );
};

// Loading Gate Component (heart + text + spinner)
// Ensures a minimum display time so the heart animation doesn't flash
const SessionGate = ({ navigation }) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const [loadingText, setLoadingText] = useState('Checking love connection');
  const [currentProfile, setCurrentProfile] = useState('me');
  const { theme } = useTheme?.();

  // Track when the gate mounted and enforce minimum visible time
  const gateStartRef = useRef(Date.now());
  const MIN_GATE_MS = 2400; // Adjust how long the heart stays visible (in ms)

  const routeTo = name => {
    navigation.reset({ index: 0, routes: [{ name }] });
  };

  const navigateAfterMinGate = name => {
    const elapsed = Date.now() - gateStartRef.current;
    const delay = Math.max(0, MIN_GATE_MS - elapsed);
    setTimeout(() => routeTo(name), delay);
  };

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 4,
        useNativeDriver: true,
      }),
    ]).start();

    // Slow, continuous spin for the heart
    Animated.loop(
      Animated.sequence([
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: 2400,
          useNativeDriver: true,
        }),
        Animated.timing(rotateAnim, {
          toValue: 0,
          duration: 2400,
          useNativeDriver: true,
        }),
      ]),
    ).start();

    // Rotate through loading messages
    const texts = [
      'Checking love connection',
      'Loading your memories',
      'Preparing your gallery',
      'Almost there',
    ];
    let index = 0;
    const textInterval = setInterval(() => {
      index = (index + 1) % texts.length;
      setLoadingText(texts[index]);
    }, 1500);

    return () => clearInterval(textInterval);
  }, [fadeAnim, scaleAnim, rotateAnim]);

  useEffect(() => {
    let mounted = true;

    const check = async () => {
      try {
        console.log('[Gate] checking session...');
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('current_profile')
            .eq('id', session.user.id)
            .single();

          if (profile) {
            setCurrentProfile(profile.current_profile || 'me');
          }

          // Enforce minimum display time for the gate
          navigateAfterMinGate('MainTabs');
        } else {
          navigateAfterMinGate('ProfileSelector');
        }
      } catch (e) {
        console.log('[Gate] check error:', e);
        navigateAfterMinGate('ProfileSelector');
      }
    };
    check();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[Gate] auth change event:', event, 'session?', !!session);
      if (!mounted) return;
      if (session) navigateAfterMinGate('MainTabs');
      else navigateAfterMinGate('ProfileSelector');
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, [navigation]);

  const profileColors = getColorsForProfile(currentProfile, theme);

  return (
    <LinearGradient
      colors={[profileColors.background, '#ffffff']}
      style={styles.gateContainer}
    >
      <Animated.View
        style={{
          opacity: fadeAnim,
          transform: [
            { scale: scaleAnim },
            {
              rotate: rotateAnim.interpolate({
                inputRange: [0, 1],
                outputRange: ['0deg', '360deg'],
              }),
            },
          ],
        }}
      >
        <LinearGradient
          colors={profileColors.gradient}
          style={[
            styles.heartContainer,
            { shadowColor: profileColors.primary },
          ]}
        >
          <Icon name="heart" size={50} color="#fff" />
        </LinearGradient>
      </Animated.View>

      <Animated.Text
        style={[
          styles.loadingText,
          { opacity: fadeAnim, color: profileColors.primary },
        ]}
      >
        {loadingText}
      </Animated.Text>

      <Animated.View style={{ opacity: fadeAnim }}>
        <ActivityIndicator size="large" color={profileColors.primary} />
      </Animated.View>

      <Animated.View style={[styles.madeWithLove, { opacity: fadeAnim }]}>
        <Text style={{ color: profileColors.tertiary, fontSize: 12 }}>
          Made with 💕
        </Text>
      </Animated.View>
    </LinearGradient>
  );
};

// Custom Tab Bar Component (hides on Camera and Chat tabs)
const CustomTabBar = ({ state, descriptors, navigation }) => {
  const [currentProfile, setCurrentProfile] = useState('me');
  const { theme } = useTheme?.();

  useEffect(() => {
    const getProfile = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('current_profile')
            .eq('id', user.id)
            .single();

          if (profile) {
            setCurrentProfile(profile.current_profile || 'me');
          }
        }
      } catch (error) {
        console.log('Profile fetch error:', error);
      }
    };
    getProfile();
  }, []);

  // Hide tab bar for Camera and Chat screens
  const currentRoute = state.routes[state.index];
  if (currentRoute.name === 'Camera' || currentRoute.name === 'Chat') {
    return null;
  }

  const profileColors = getColorsForProfile(currentProfile, theme);

  return (
    <View style={styles.tabBarContainer}>
      <LinearGradient
        colors={['transparent', 'rgba(255,255,255,0.9)']}
        style={styles.tabBarGradient}
        pointerEvents="none"
      />

      <View style={[styles.tabBar, { shadowColor: profileColors.primary }]}>
        <LinearGradient
          colors={[
            (profileColors.primary || '#000000') + '10',
            (profileColors.secondary || '#000000') + '05',
          ]}
          style={styles.tabBarBackground}
        />

        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const isFocused = state.index === index;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });

            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          const onLongPress = () => {
            navigation.emit({
              type: 'tabLongPress',
              target: route.key,
            });
          };

          let iconName;
          if (route.name === 'Gallery')
            iconName = isFocused ? 'images' : 'images-outline';
          else if (route.name === 'Favorites')
            iconName = isFocused ? 'heart' : 'heart-outline';
          else if (route.name === 'Camera')
            iconName = isFocused ? 'camera' : 'camera-outline';
          else if (route.name === 'Chat')
            iconName = isFocused ? 'chatbubbles' : 'chatbubbles-outline';

          return (
            <TouchableOpacity
              key={route.key}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              accessibilityLabel={options.tabBarAccessibilityLabel}
              testID={options.tabBarTestID}
              onPress={onPress}
              onLongPress={onLongPress}
              style={styles.tabButton}
            >
              <TabIcon
                focused={isFocused}
                iconName={iconName}
                color={isFocused ? profileColors.primary : '#999'}
                profile={currentProfile}
              />
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

// Main Tabs
function MainTabs() {
  return (
    <Tab.Navigator
      tabBar={props => <CustomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tab.Screen name="Gallery" component={GalleryScreen} />
      <Tab.Screen name="Favorites" component={FavoritesScreen} />
      <Tab.Screen name="Camera" component={CameraScreen} />
      <Tab.Screen name="Chat" component={PrivateChatScreen} />
    </Tab.Navigator>
  );
}

// App Navigator
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
    <Stack.Screen name="ThemesStickers" component={ThemesStickersScreen} />
    <Stack.Screen name="PrivateChat" component={PrivateChatScreen} />
    <Stack.Screen name="PhotoVault" component={PhotoVaultScreen} />
    <Stack.Screen name="Personalization" component={PersonalizationScreen} />
  </Stack.Navigator>
);

const styles = StyleSheet.create({
  gateContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heartContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 30,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 10,
  },
  loadingText: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 20,
  },
  madeWithLove: {
    position: 'absolute',
    bottom: 50,
  },
  focusedIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unfocusedIconContainer: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeIndicator: {
    width: 24,
    height: 3,
    borderRadius: 2,
  },
  tabBarContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  tabBarGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 100,
  },
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: Platform.OS === 'ios' ? 28 : 20,
    borderRadius: 30,
    backgroundColor: '#fff',
    height: Platform.OS === 'ios' ? 70 : 65,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 10,
    overflow: 'hidden',
  },
  tabBarBackground: {
    ...StyleSheet.absoluteFillObject,
  },
  tabButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default AppNavigator;

// // AppNavigator.js - Fixed with conditional tab bar hiding, no notification badge,
// // and longer SessionGate animation via minimum display time

// import React, { useEffect, useState, useRef } from 'react';
// import {
//   ActivityIndicator,
//   View,
//   Platform,
//   Animated,
//   Text,
//   TouchableOpacity,
//   Dimensions,
//   StyleSheet,
// } from 'react-native';
// import { createNativeStackNavigator } from '@react-navigation/native-stack';
// import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
// import Icon from 'react-native-vector-icons/Ionicons';
// import LinearGradient from 'react-native-linear-gradient';
// import { supabase } from '../services/supabase';

// // Default colors fallback if COLORS is not defined
// const DEFAULT_COLORS = {
//   blue: {
//     primary: '#4A90E2',
//     secondary: '#5CA0F2',
//     tertiary: '#6CB0FF',
//     background: '#F0F8FF',
//   },
//   pink: {
//     primary: '#FF6B9D',
//     secondary: '#FF8E9E',
//     tertiary: '#FFB1B3',
//     background: '#FFF0F5',
//   },
// };

// // Import COLORS with fallback
// let COLORS;
// try {
//   // eslint-disable-next-line global-require
//   COLORS = require('../theme/colors').COLORS || DEFAULT_COLORS;
// } catch (e) {
//   console.log('Using default colors');
//   COLORS = DEFAULT_COLORS;
// }

// // Import screens
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

// const { width: SCREEN_WIDTH } = Dimensions.get('window');

// // Helper function to get safe colors
// const getSafeColors = (profile = 'me') => {
//   const colorSet =
//     (profile === 'me' ? COLORS?.blue : COLORS?.pink) || DEFAULT_COLORS.blue;
//   return {
//     primary: colorSet.primary || DEFAULT_COLORS.blue.primary,
//     secondary: colorSet.secondary || DEFAULT_COLORS.blue.secondary,
//     tertiary: colorSet.tertiary || DEFAULT_COLORS.blue.tertiary,
//     background: colorSet.background || DEFAULT_COLORS.blue.background,
//     gradient: [
//       colorSet.primary || DEFAULT_COLORS.blue.primary,
//       colorSet.secondary || DEFAULT_COLORS.blue.secondary,
//     ],
//   };
// };

// // Animated Tab Icon Component (no notification badge, no profile indicator)
// const TabIcon = ({ focused, iconName, color, profile }) => {
//   const scaleAnim = useRef(new Animated.Value(1)).current;
//   const rotateAnim = useRef(new Animated.Value(0)).current;

//   useEffect(() => {
//     if (focused) {
//       Animated.parallel([
//         Animated.spring(scaleAnim, {
//           toValue: 1.2,
//           friction: 3,
//           useNativeDriver: true,
//         }),
//         Animated.timing(rotateAnim, {
//           toValue: 1,
//           duration: 300,
//           useNativeDriver: true,
//         }),
//       ]).start(() => {
//         Animated.spring(scaleAnim, {
//           toValue: 1,
//           friction: 3,
//           useNativeDriver: true,
//         }).start();
//       });
//     } else {
//       Animated.parallel([
//         Animated.timing(scaleAnim, {
//           toValue: 1,
//           duration: 200,
//           useNativeDriver: true,
//         }),
//         Animated.timing(rotateAnim, {
//           toValue: 0,
//           duration: 200,
//           useNativeDriver: true,
//         }),
//       ]).start();
//     }
//   }, [focused, rotateAnim, scaleAnim]);

//   const profileColors = getSafeColors(profile);

//   return (
//     <View style={{ alignItems: 'center', justifyContent: 'center' }}>
//       <Animated.View
//         style={{
//           transform: [
//             { scale: scaleAnim },
//             {
//               rotate: rotateAnim.interpolate({
//                 inputRange: [0, 1],
//                 outputRange: ['0deg', '360deg'],
//               }),
//             },
//           ],
//         }}
//       >
//         {focused ? (
//           <LinearGradient
//             colors={profileColors.gradient}
//             style={styles.focusedIconContainer}
//           >
//             <Icon name={iconName} size={24} color="#fff" />
//           </LinearGradient>
//         ) : (
//           <View style={styles.unfocusedIconContainer}>
//             <Icon name={iconName} size={26} color={color} />
//           </View>
//         )}
//       </Animated.View>
//     </View>
//   );
// };

// // Loading Gate Component (heart + text + spinner)
// // Ensures a minimum display time so the heart animation doesn't flash
// const SessionGate = ({ navigation }) => {
//   const fadeAnim = useRef(new Animated.Value(0)).current;
//   const scaleAnim = useRef(new Animated.Value(0.8)).current;
//   const rotateAnim = useRef(new Animated.Value(0)).current;
//   const [loadingText, setLoadingText] = useState('Checking love connection');
//   const [currentProfile, setCurrentProfile] = useState('me');

//   // Track when the gate mounted and enforce minimum visible time
//   const gateStartRef = useRef(Date.now());
//   const MIN_GATE_MS = 2400; // Adjust how long the heart stays visible (in ms)

//   const routeTo = name => {
//     navigation.reset({ index: 0, routes: [{ name }] });
//   };

//   const navigateAfterMinGate = name => {
//     const elapsed = Date.now() - gateStartRef.current;
//     const delay = Math.max(0, MIN_GATE_MS - elapsed);
//     setTimeout(() => routeTo(name), delay);
//   };

//   useEffect(() => {
//     Animated.parallel([
//       Animated.timing(fadeAnim, {
//         toValue: 1,
//         duration: 800,
//         useNativeDriver: true,
//       }),
//       Animated.spring(scaleAnim, {
//         toValue: 1,
//         friction: 4,
//         useNativeDriver: true,
//       }),
//     ]).start();

//     // Slow, continuous spin for the heart
//     Animated.loop(
//       Animated.sequence([
//         Animated.timing(rotateAnim, {
//           toValue: 1,
//           duration: 2400,
//           useNativeDriver: true,
//         }),
//         Animated.timing(rotateAnim, {
//           toValue: 0,
//           duration: 2400,
//           useNativeDriver: true,
//         }),
//       ]),
//     ).start();

//     // Rotate through loading messages
//     const texts = [
//       'Checking love connection',
//       'Loading your memories',
//       'Preparing your gallery',
//       'Almost there',
//     ];
//     let index = 0;
//     const textInterval = setInterval(() => {
//       index = (index + 1) % texts.length;
//       setLoadingText(texts[index]);
//     }, 1500);

//     return () => clearInterval(textInterval);
//   }, [fadeAnim, scaleAnim, rotateAnim]);

//   useEffect(() => {
//     let mounted = true;

//     const check = async () => {
//       try {
//         console.log('[Gate] checking session...');
//         const {
//           data: { session },
//         } = await supabase.auth.getSession();

//         if (session) {
//           const { data: profile } = await supabase
//             .from('profiles')
//             .select('current_profile')
//             .eq('id', session.user.id)
//             .single();

//           if (profile) {
//             setCurrentProfile(profile.current_profile || 'me');
//           }

//           // Enforce minimum display time for the gate
//           navigateAfterMinGate('MainTabs');
//         } else {
//           navigateAfterMinGate('ProfileSelector');
//         }
//       } catch (e) {
//         console.log('[Gate] check error:', e);
//         navigateAfterMinGate('ProfileSelector');
//       }
//     };
//     check();

//     const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
//       console.log('[Gate] auth change event:', event, 'session?', !!session);
//       if (!mounted) return;
//       if (session) navigateAfterMinGate('MainTabs');
//       else navigateAfterMinGate('ProfileSelector');
//     });

//     return () => {
//       mounted = false;
//       sub?.subscription?.unsubscribe?.();
//     };
//   }, [navigation]);

//   const profileColors = getSafeColors(currentProfile);

//   return (
//     <LinearGradient
//       colors={[profileColors.background, '#ffffff']}
//       style={styles.gateContainer}
//     >
//       <Animated.View
//         style={{
//           opacity: fadeAnim,
//           transform: [
//             { scale: scaleAnim },
//             {
//               rotate: rotateAnim.interpolate({
//                 inputRange: [0, 1],
//                 outputRange: ['0deg', '360deg'],
//               }),
//             },
//           ],
//         }}
//       >
//         <LinearGradient
//           colors={profileColors.gradient}
//           style={[
//             styles.heartContainer,
//             { shadowColor: profileColors.primary },
//           ]}
//         >
//           <Icon name="heart" size={50} color="#fff" />
//         </LinearGradient>
//       </Animated.View>

//       <Animated.Text
//         style={[
//           styles.loadingText,
//           { opacity: fadeAnim, color: profileColors.primary },
//         ]}
//       >
//         {loadingText}
//       </Animated.Text>

//       <Animated.View style={{ opacity: fadeAnim }}>
//         <ActivityIndicator size="large" color={profileColors.primary} />
//       </Animated.View>

//       <Animated.View style={[styles.madeWithLove, { opacity: fadeAnim }]}>
//         <Text style={{ color: profileColors.tertiary, fontSize: 12 }}>
//           Made with 💕
//         </Text>
//       </Animated.View>
//     </LinearGradient>
//   );
// };

// // Custom Tab Bar Component (hides on Camera and Chat tabs)
// const CustomTabBar = ({ state, descriptors, navigation }) => {
//   const [currentProfile, setCurrentProfile] = useState('me');

//   useEffect(() => {
//     const getProfile = async () => {
//       try {
//         const {
//           data: { user },
//         } = await supabase.auth.getUser();
//         if (user) {
//           const { data: profile } = await supabase
//             .from('profiles')
//             .select('current_profile')
//             .eq('id', user.id)
//             .single();

//           if (profile) {
//             setCurrentProfile(profile.current_profile || 'me');
//           }
//         }
//       } catch (error) {
//         console.log('Profile fetch error:', error);
//       }
//     };
//     getProfile();
//   }, []);

//   // Hide tab bar for Camera and Chat screens
//   const currentRoute = state.routes[state.index];
//   if (currentRoute.name === 'Camera' || currentRoute.name === 'Chat') {
//     return null;
//   }

//   const profileColors = getSafeColors(currentProfile);

//   return (
//     <View style={styles.tabBarContainer}>
//       <LinearGradient
//         colors={['transparent', 'rgba(255,255,255,0.9)']}
//         style={styles.tabBarGradient}
//         pointerEvents="none"
//       />

//       <View style={[styles.tabBar, { shadowColor: profileColors.primary }]}>
//         <LinearGradient
//           colors={[
//             profileColors.primary + '10',
//             profileColors.secondary + '05',
//           ].map(c => (String(c).includes('null') ? '#00000010' : c))}
//           style={styles.tabBarBackground}
//         />

//         {state.routes.map((route, index) => {
//           const { options } = descriptors[route.key];
//           const isFocused = state.index === index;

//           const onPress = () => {
//             const event = navigation.emit({
//               type: 'tabPress',
//               target: route.key,
//               canPreventDefault: true,
//             });

//             if (!isFocused && !event.defaultPrevented) {
//               navigation.navigate(route.name);
//             }
//           };

//           const onLongPress = () => {
//             navigation.emit({
//               type: 'tabLongPress',
//               target: route.key,
//             });
//           };

//           let iconName;
//           if (route.name === 'Gallery')
//             iconName = isFocused ? 'images' : 'images-outline';
//           else if (route.name === 'Favorites')
//             iconName = isFocused ? 'heart' : 'heart-outline';
//           else if (route.name === 'Camera')
//             iconName = isFocused ? 'camera' : 'camera-outline';
//           else if (route.name === 'Chat')
//             iconName = isFocused ? 'chatbubbles' : 'chatbubbles-outline';

//           return (
//             <TouchableOpacity
//               key={route.key}
//               accessibilityRole="button"
//               accessibilityState={isFocused ? { selected: true } : {}}
//               accessibilityLabel={options.tabBarAccessibilityLabel}
//               testID={options.tabBarTestID}
//               onPress={onPress}
//               onLongPress={onLongPress}
//               style={styles.tabButton}
//             >
//               <TabIcon
//                 focused={isFocused}
//                 iconName={iconName}
//                 color={isFocused ? profileColors.primary : '#999'}
//                 profile={currentProfile}
//               />
//             </TouchableOpacity>
//           );
//         })}
//       </View>
//     </View>
//   );
// };

// // Main Tabs
// function MainTabs() {
//   return (
//     <Tab.Navigator
//       tabBar={props => <CustomTabBar {...props} />}
//       screenOptions={{
//         headerShown: false,
//         tabBarHideOnKeyboard: true,
//       }}
//     >
//       <Tab.Screen name="Gallery" component={GalleryScreen} />
//       <Tab.Screen name="Favorites" component={FavoritesScreen} />
//       <Tab.Screen name="Camera" component={CameraScreen} />
//       <Tab.Screen name="Chat" component={PrivateChatScreen} />
//     </Tab.Navigator>
//   );
// }

// // App Navigator
// const AppNavigator = () => (
//   <Stack.Navigator
//     initialRouteName="Gate"
//     screenOptions={{
//       headerShown: false,
//       animation: 'slide_from_right',
//       gestureEnabled: true,
//     }}
//   >
//     <Stack.Screen
//       name="Gate"
//       component={SessionGate}
//       options={{ animation: 'fade' }}
//     />
//     <Stack.Screen
//       name="ProfileSelector"
//       component={ProfileSelectorScreen}
//       options={{ animation: 'fade' }}
//     />
//     <Stack.Screen
//       name="Auth"
//       component={AuthScreen}
//       options={{ animation: 'slide_from_bottom' }}
//     />
//     <Stack.Screen
//       name="MainTabs"
//       component={MainTabs}
//       options={{ animation: 'fade' }}
//     />
//     <Stack.Screen name="DayGallery" component={DayGalleryScreen} />
//     <Stack.Screen
//       name="Profile"
//       component={ProfileScreen}
//       options={{ animation: 'slide_from_bottom' }}
//     />
//     <Stack.Screen name="SharedCalendar" component={SharedCalendarScreen} />
//     <Stack.Screen name="ThemesStickers" component={ThemesStickersScreen} />
//     <Stack.Screen name="PrivateChat" component={PrivateChatScreen} />
//     <Stack.Screen name="PhotoVault" component={PhotoVaultScreen} />
//     <Stack.Screen name="Personalization" component={PersonalizationScreen} />
//   </Stack.Navigator>
// );

// const styles = StyleSheet.create({
//   gateContainer: {
//     flex: 1,
//     alignItems: 'center',
//     justifyContent: 'center',
//   },
//   heartContainer: {
//     width: 100,
//     height: 100,
//     borderRadius: 50,
//     justifyContent: 'center',
//     alignItems: 'center',
//     marginBottom: 30,
//     shadowOffset: { width: 0, height: 8 },
//     shadowOpacity: 0.3,
//     shadowRadius: 16,
//     elevation: 10,
//   },
//   loadingText: {
//     fontSize: 18,
//     fontWeight: '600',
//     marginBottom: 20,
//   },
//   madeWithLove: {
//     position: 'absolute',
//     bottom: 50,
//   },
//   focusedIconContainer: {
//     width: 44,
//     height: 44,
//     borderRadius: 22,
//     justifyContent: 'center',
//     alignItems: 'center',
//   },
//   unfocusedIconContainer: {
//     width: 44,
//     height: 44,
//     justifyContent: 'center',
//     alignItems: 'center',
//   },
//   activeIndicator: {
//     width: 24,
//     height: 3,
//     borderRadius: 2,
//   },
//   tabBarContainer: {
//     position: 'absolute',
//     bottom: 0,
//     left: 0,
//     right: 0,
//   },
//   tabBarGradient: {
//     position: 'absolute',
//     bottom: 0,
//     left: 0,
//     right: 0,
//     height: 100,
//   },
//   tabBar: {
//     flexDirection: 'row',
//     marginHorizontal: 20,
//     marginBottom: Platform.OS === 'ios' ? 28 : 20,
//     borderRadius: 30,
//     backgroundColor: '#fff',
//     height: Platform.OS === 'ios' ? 70 : 65,
//     shadowOffset: { width: 0, height: 8 },
//     shadowOpacity: 0.15,
//     shadowRadius: 16,
//     elevation: 10,
//     overflow: 'hidden',
//   },
//   tabBarBackground: {
//     ...StyleSheet.absoluteFillObject,
//   },
//   tabButton: {
//     flex: 1,
//     justifyContent: 'center',
//     alignItems: 'center',
//   },
// });

// export default AppNavigator;
