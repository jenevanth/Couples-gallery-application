// screens/ProfileSelectorScreen.js
import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../services/supabase';
import { useTheme } from '../theme/ThemeContext';

const log = (...a) => console.log('[ProfileSelector]', ...a);

const ProfileSelectorScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(false);
  const { theme, setCurrentTheme } = useTheme(); // IMPORTANT: using setCurrentTheme

  const handleSelect = async profile => {
    log('Selected:', profile);

    // 1) Immediately apply theme so Auth/other screens are colored correctly
    const chosenTheme = profile === 'her' ? 'pink' : 'blue';
    try {
      log(
        'Calling setCurrentTheme with:',
        chosenTheme,
        'typeof:',
        typeof setCurrentTheme,
      );
      if (typeof setCurrentTheme === 'function') {
        await setCurrentTheme(chosenTheme);
        log('Theme set immediately to:', chosenTheme);
      } else {
        log(
          'WARN: setCurrentTheme is not a function; check ThemeContext export.',
        );
      }
    } catch (e) {
      log('ERROR setCurrentTheme failed:', e);
    }

    setLoading(true);
    try {
      // 2) Check session
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();
      log('getSession → session?', !!session, 'error?', error || null);

      if (session?.user) {
        const userId = session.user.id;
        log('Session user id:', userId);

        // RLS-friendly upsert (id must equal auth.uid())
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
        // 3) No session yet → remember choice and go Auth
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
    <View style={styles.container}>
      <Text style={styles.title}>Who are you?</Text>

      <TouchableOpacity
        style={[styles.button, { backgroundColor: '#4FC3F7' }]}
        onPress={() => handleSelect('me')}
        disabled={loading}
      >
        <Text style={styles.buttonText}>Bugaa Boo (Me)</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.button, { backgroundColor: '#FF80AB' }]}
        onPress={() => handleSelect('her')}
        disabled={loading}
      >
        <Text style={styles.buttonText}>Bhoo Boo (Her)</Text>
      </TouchableOpacity>

      {loading && (
        <ActivityIndicator
          size="large"
          color="#4FC3F7"
          style={{ marginTop: 20 }}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f8f8',
  },
  title: { fontSize: 28, fontWeight: 'bold', marginBottom: 40 },
  button: {
    padding: 20,
    borderRadius: 16,
    marginVertical: 16,
    width: 220,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
});

export default ProfileSelectorScreen;

// import React from 'react';
// import {
//   View,
//   Text,
//   TouchableOpacity,
//   StyleSheet,
//   ActivityIndicator,
// } from 'react-native';
// import { supabase } from '../services/supabase';

// const ProfileSelectorScreen = ({ navigation }) => {
//   const [loading, setLoading] = React.useState(false);

//   const handleSelect = async profile => {
//     setLoading(true);
//     const {
//       data: { user },
//     } = await supabase.auth.getUser();
//     await supabase
//       .from('profiles')
//       .update({ current_profile: profile })
//       .eq('id', user.id);
//     setLoading(false);
//     navigation.replace('MainTabs');
//   };

//   return (
//     <View style={styles.container}>
//       <Text style={styles.title}>Who are you?</Text>
//       <TouchableOpacity
//         style={[styles.button, { backgroundColor: '#4FC3F7' }]}
//         onPress={() => handleSelect('me')}
//       >
//         <Text style={styles.buttonText}>Bugaa Boo (Me)</Text>
//       </TouchableOpacity>
//       <TouchableOpacity
//         style={[styles.button, { backgroundColor: '#FF80AB' }]}
//         onPress={() => handleSelect('her')}
//       >
//         <Text style={styles.buttonText}>Bhoo Boo (Her)</Text>
//       </TouchableOpacity>
//       {loading && (
//         <ActivityIndicator
//           size="large"
//           color="#4FC3F7"
//           style={{ marginTop: 20 }}
//         />
//       )}
//     </View>
//   );
// };

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     justifyContent: 'center',
//     alignItems: 'center',
//     backgroundColor: '#f8f8f8',
//   },
//   title: { fontSize: 28, fontWeight: 'bold', marginBottom: 40 },
//   button: {
//     padding: 20,
//     borderRadius: 16,
//     marginVertical: 16,
//     width: 220,
//     alignItems: 'center',
//   },
//   buttonText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
// });

// export default ProfileSelectorScreen;
