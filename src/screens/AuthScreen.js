// screens/AuthScreen.js
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Alert,
  TouchableOpacity,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../theme/ThemeContext';
import { supabase } from '../services/supabase';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import ThemedButton from '../components/ThemedButton';
import { Svg, Path } from 'react-native-svg';

const log = (...a) => console.log('[Auth]', ...a);

// Option 1: in-app signup disabled
const ENABLE_IN_APP_SIGNUP = false;

// Optional deep link for password reset (configure Android intent-filter if you want in-app reset)
const APP_SCHEME = 'boyfriendneeds';
const RESET_LINK = `${APP_SCHEME}://reset`;

const GoogleIcon = () => (
  <Svg height="24" width="24" viewBox="0 0 48 48">
    <Path
      fill="#FFC107"
      d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039L38.802 9.92C34.553 6.186 29.656 4 24 4C12.955 4 4 12.955 4 24s8.955 20 20 20s20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
    />
    <Path
      fill="#FF3D00"
      d="M6.306 14.691c-1.324 2.596-2.083 5.564-2.083 8.657s.759 6.06 2.083 8.657L12.55 30.75C10.125 27.259 8.611 23.633 8.611 20c0-3.633 1.514-7.259 3.939-10.75L6.306 14.691z"
    />
    <Path
      fill="#4CAF50"
      d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
    />
    <Path
      fill="#1976D2"
      d="M43.611 20.083L43.595 20.083L42 20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039L38.802 9.92C34.553 6.186 29.656 4 24 4C12.955 4 4 12.955 4 24s8.955 20 20 20s20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
    />
  </Svg>
);

const AuthScreen = ({ navigation }) => {
  const { theme, setCurrentTheme } = useTheme(); // IMPORTANT: using setCurrentTheme
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // Apply pending profile theme on mount so Auth is pink/blue immediately
  useEffect(() => {
    (async () => {
      try {
        const pending = await AsyncStorage.getItem('pending_profile');
        log('pending_profile from storage:', pending);
        if (pending) {
          const chosen = pending === 'her' ? 'pink' : 'blue';
          log(
            'Calling setCurrentTheme with:',
            chosen,
            'typeof:',
            typeof setCurrentTheme,
          );
          if (typeof setCurrentTheme === 'function') {
            await setCurrentTheme(chosen);
            log('Applied theme on Auth:', chosen);
          } else {
            log('WARN setCurrentTheme not a function');
          }
        } else {
          log('No pending_profile saved');
        }
      } catch (e) {
        log('pending_profile read error:', e);
      }
    })();
  }, [setCurrentTheme]);

  // Session listeners (Gate also routes—but keep this for responsiveness)
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      log('Initial session exists:', !!session);
      if (session) navigation.replace('MainTabs');
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      log('Auth state changed. Session exists:', !!session);
      if (session) navigation.replace('MainTabs');
    });
    return () => subscription.unsubscribe();
  }, [navigation]);

  const handleSignIn = async () => {
    if (!email || !password) return;
    setLoading(true);
    try {
      log('Attempting sign in:', email);
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        log('Sign In error:', error);
        Alert.alert('Sign In Error', error.message);
      } else {
        log('Sign In successful');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async () => {
    Alert.alert(
      'Signup disabled',
      'Ask admin to create your account in Supabase.',
    );
    log('SignUp blocked (Option 1).');
  };

  const handleForgotPassword = async () => {
    if (!email) return Alert.alert('Enter email', 'Please type your email.');
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: RESET_LINK, // optional deep link (configure if you want in-app reset)
      });
      if (error) {
        log('Reset error:', error);
        Alert.alert('Reset error', error.message);
        return;
      }
      Alert.alert('Check your email', 'Open the link to set a new password.');
      log('Reset email sent.');
    } finally {
      setLoading(false);
    }
  };

  const onGoogleButtonPress = async () => {
    try {
      setLoading(true);
      log('Starting Google Sign-In');
      await GoogleSignin.hasPlayServices();
      const { idToken } = await GoogleSignin.signIn();
      if (!idToken) throw new Error('No Google ID token');
      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      });
      if (error) throw error;
      log('Google Sign-In OK');
    } catch (e) {
      log('Google Sign-In error:', e);
      Alert.alert('Google Sign-In Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: '#121212' }]}>
      <Text style={[styles.title, { color: theme.colors.primary }]}>
        boyfriend_needs
      </Text>

      <TextInput
        style={[styles.input, { borderColor: '#A9A9A9', color: '#fff' }]}
        placeholder="Email"
        placeholderTextColor="#A9A9A9"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <TextInput
        style={[styles.input, { borderColor: '#A9A9A9', color: '#fff' }]}
        placeholder="Password"
        placeholderTextColor="#A9A9A9"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <ThemedButton title="Sign In" onPress={handleSignIn} disabled={loading} />
      <ThemedButton title="Sign Up" onPress={handleSignUp} disabled={loading} />

      <TouchableOpacity
        onPress={handleForgotPassword}
        style={{ marginTop: 12 }}
      >
        <Text style={{ color: theme.colors.primary, fontWeight: 'bold' }}>
          Forgot password?
        </Text>
      </TouchableOpacity>

      <Text style={styles.orText}>OR</Text>

      <TouchableOpacity
        style={[styles.googleButton, { borderColor: '#4285F4' }]}
        onPress={onGoogleButtonPress}
        disabled={loading}
      >
        <GoogleIcon />
        <Text style={styles.googleButtonText}>Sign in with Google</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: { fontSize: 32, fontWeight: 'bold', marginBottom: 40 },
  input: {
    width: '100%',
    height: 50,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 15,
    fontSize: 16,
    marginBottom: 15,
    backgroundColor: '#121212',
  },
  orText: { marginVertical: 20, fontSize: 16, color: '#A9A9A9' },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#121212',
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 8,
  },
  googleButtonText: {
    color: 'white',
    marginLeft: 12,
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default AuthScreen;
