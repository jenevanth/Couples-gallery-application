/**
 * src/screens/AuthScreen.js
 * Handles user login using Supabase for Email/Password and Google Sign-In.
 * -- UPDATED WITH CONSOLE LOGS FOR DEBUGGING --
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { supabase } from '../services/supabase';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import ThemedButton from '../components/ThemedButton';
import { Svg, Path } from 'react-native-svg';

// Inline SVG for the Google Icon - no external files needed
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
  const { theme } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        console.log(
          '[AuthScreen] Found active session, navigating to Gallery.',
        );
        navigation.replace('MainTabs');
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      console.log(
        `[AuthScreen] Auth state changed. Session exists: ${!!session}`,
      );
      if (session) {
        navigation.replace('Gallery');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSignUp = async () => {
    if (!email || !password) return;
    setLoading(true);
    console.log(`[AuthScreen] Attempting to sign up with email: ${email}`);
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) {
      console.error('[AuthScreen] Sign Up Error:', error.message);
      Alert.alert('Sign Up Error', error.message);
    } else {
      console.log('[AuthScreen] Sign Up successful. Confirmation email sent.');
      Alert.alert(
        'Success!',
        'Please check your email for a confirmation link.',
      );
    }
    setLoading(false);
  };

  const handleSignIn = async () => {
    if (!email || !password) return;
    setLoading(true);
    console.log(`[AuthScreen] Attempting to sign in with email: ${email}`);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      console.error('[AuthScreen] Sign In Error:', error.message);
      Alert.alert('Sign In Error', error.message);
    } else {
      console.log('[AuthScreen] Sign In successful.');
    }
    setLoading(false);
  };

  const onGoogleButtonPress = async () => {
    try {
      setLoading(true);
      console.log('[AuthScreen] Starting Google Sign-In process...');
      await GoogleSignin.hasPlayServices();
      const { idToken } = await GoogleSignin.signIn();
      if (idToken) {
        console.log(
          '[AuthScreen] Received ID token from Google. Signing in with Supabase...',
        );
        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: idToken,
        });
        if (error) throw error;
        console.log('[AuthScreen] Supabase Google Sign-In successful.');
      } else {
        throw new Error('No ID token received from Google.');
      }
    } catch (error) {
      console.error('[AuthScreen] Google Sign-In Error:', error.message);
      Alert.alert('Google Sign-In Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: theme.colors.primary }]}>
        boyfriend_needs
      </Text>
      <TextInput
        style={[styles.input, { borderColor: theme.gray }]}
        placeholder="Email"
        placeholderTextColor={theme.gray}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <TextInput
        style={[styles.input, { borderColor: theme.gray }]}
        placeholder="Password"
        placeholderTextColor={theme.gray}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <ThemedButton title="Sign In" onPress={handleSignIn} disabled={loading} />
      <ThemedButton title="Sign Up" onPress={handleSignUp} disabled={loading} />
      <Text style={styles.orText}>OR</Text>
      <TouchableOpacity
        style={styles.googleButton}
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
    backgroundColor: '#121212',
  },
  title: { fontSize: 32, fontWeight: 'bold', marginBottom: 40 },
  input: {
    width: '100%',
    height: 50,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 15,
    fontSize: 16,
    color: 'white',
    marginBottom: 15,
  },
  orText: { marginVertical: 20, fontSize: 16, color: '#A9A9A9' },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#4285F4',
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 8,
  },
  googleButtonText: {
    color: 'white',
    marginLeft: 15,
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default AuthScreen;
