// screens/ProfileSelectorScreen.js
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../services/supabase';
import { useTheme } from '../theme/ThemeContext';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';

const log = (...a) => console.log('[ProfileSelector]', ...a);

const { width, height } = Dimensions.get('window');

const ProfileSelectorScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(false);
  const { theme, setCurrentTheme } = useTheme();

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const titleAnim = useRef(new Animated.Value(-50)).current;
  const button1Anim = useRef(new Animated.Value(-width)).current;
  const button2Anim = useRef(new Animated.Value(width)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Animate on mount
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      }),
      Animated.spring(titleAnim, {
        toValue: 0,
        friction: 4,
        tension: 40,
        useNativeDriver: true,
      }),
      Animated.spring(button1Anim, {
        toValue: 0,
        friction: 5,
        tension: 35,
        delay: 200,
        useNativeDriver: true,
      }),
      Animated.spring(button2Anim, {
        toValue: 0,
        friction: 5,
        tension: 35,
        delay: 400,
        useNativeDriver: true,
      }),
    ]).start();

    // Pulse animation for icons
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, []);

  const handleSelect = async profile => {
    log('Selected:', profile);

    // Haptic feedback animation
    Animated.sequence([
      Animated.timing(profile === 'me' ? button1Anim : button2Anim, {
        toValue: 10,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(profile === 'me' ? button1Anim : button2Anim, {
        toValue: 0,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();

    // Apply theme immediately
    const chosenTheme = profile === 'her' ? 'pink' : 'blue';
    try {
      log('Calling setCurrentTheme with:', chosenTheme);
      if (typeof setCurrentTheme === 'function') {
        await setCurrentTheme(chosenTheme);
        log('Theme set immediately to:', chosenTheme);
      }
    } catch (e) {
      log('ERROR setCurrentTheme failed:', e);
    }

    setLoading(true);
    try {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();
      log('getSession → session?', !!session, 'error?', error || null);

      if (session?.user) {
        const userId = session.user.id;
        log('Session user id:', userId);

        const { error: upErr } = await supabase.from('profiles').upsert({
          id: userId,
          current_profile: profile,
          updated_at: new Date().toISOString(),
        });

        if (upErr) {
          log('profiles upsert error:', upErr);
          Alert.alert('Error', upErr.message);
        } else {
          log('profiles upsert success → MainTabs');
          navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
        }
      } else {
        // No session yet → remember choice and go Auth
        await AsyncStorage.setItem('pending_profile', profile);
        log('No session. Stored pending_profile:', profile, '→ go Auth');
        navigation.reset({ index: 0, routes: [{ name: 'Auth' }] });
      }
    } catch (e) {
      log('exception:', e);
      Alert.alert('Error', e?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient
      colors={['#FFE5F1', '#FFFFFF', '#E3F2FD']}
      style={styles.container}
    >
      <SafeAreaView style={styles.safeArea}>
        {/* Header */}
        <Animated.View
          style={[
            styles.header,
            {
              opacity: fadeAnim,
              transform: [{ translateY: titleAnim }],
            },
          ]}
        >
          <LinearGradient
            colors={['#FF80AB', '#4FC3F7']}
            style={styles.logoContainer}
          >
            <Icon name="heart" size={40} color="#FFFFFF" />
          </LinearGradient>
          <Text style={styles.title}>Who Are You?</Text>
          <Text style={styles.subtitle}>Choose your profile to continue</Text>
        </Animated.View>

        {/* Profile Buttons */}
        <View style={styles.buttonsContainer}>
          {/* Me Button */}
          <Animated.View
            style={[
              styles.buttonWrapper,
              {
                opacity: fadeAnim,
                transform: [{ translateX: button1Anim }],
              },
            ]}
          >
            <TouchableOpacity
              onPress={() => handleSelect('me')}
              disabled={loading}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={['#4FC3F7', '#29B6F6', '#039BE5']}
                style={styles.profileButton}
              >
                <Animated.View
                  style={[
                    styles.iconContainer,
                    { transform: [{ scale: pulseAnim }] },
                  ]}
                >
                  <Icon name="person" size={50} color="#FFFFFF" />
                </Animated.View>
                <Text style={styles.profileName}>Bugaa Boo</Text>
                <Text style={styles.profileLabel}>(Me)</Text>
                <View style={styles.badge}>
                  <Icon name="chevron-forward" size={20} color="#FFFFFF" />
                </View>
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>

          {/* Her Button */}
          <Animated.View
            style={[
              styles.buttonWrapper,
              {
                opacity: fadeAnim,
                transform: [{ translateX: button2Anim }],
              },
            ]}
          >
            <TouchableOpacity
              onPress={() => handleSelect('her')}
              disabled={loading}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={['#FF80AB', '#FF6B9D', '#E63946']}
                style={styles.profileButton}
              >
                <Animated.View
                  style={[
                    styles.iconContainer,
                    { transform: [{ scale: pulseAnim }] },
                  ]}
                >
                  <Icon name="person" size={50} color="#FFFFFF" />
                </Animated.View>
                <Text style={styles.profileName}>Bhoo Boo</Text>
                <Text style={styles.profileLabel}>(Her)</Text>
                <View style={styles.badge}>
                  <Icon name="chevron-forward" size={20} color="#FFFFFF" />
                </View>
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>
        </View>

        {/* Loading Indicator */}
        {loading && (
          <Animated.View
            style={[styles.loadingContainer, { opacity: fadeAnim }]}
          >
            <ActivityIndicator size="large" color="#4FC3F7" />
            <Text style={styles.loadingText}>Setting up your profile...</Text>
          </Animated.View>
        )}

        {/* Footer */}
        <Animated.View style={[styles.footer, { opacity: fadeAnim }]}>
          <Icon name="lock-closed" size={16} color="#999" />
          <Text style={styles.footerText}>
            Your choice is private and secure
          </Text>
        </Animated.View>
      </SafeAreaView>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    justifyContent: 'space-between',
  },
  header: {
    alignItems: 'center',
    paddingTop: 40,
    paddingHorizontal: 24,
  },
  logoContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  buttonsContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  buttonWrapper: {
    marginVertical: 12,
  },
  profileButton: {
    padding: 24,
    borderRadius: 24,
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    position: 'relative',
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  profileName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  profileLabel: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.9)',
  },
  badge: {
    position: 'absolute',
    right: 20,
    top: '50%',
    marginTop: -10,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 20,
    padding: 8,
  },
  loadingContainer: {
    position: 'absolute',
    bottom: 120,
    alignSelf: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 20,
    paddingHorizontal: 24,
  },
  footerText: {
    marginLeft: 8,
    fontSize: 14,
    color: '#999',
  },
});

export default ProfileSelectorScreen;
