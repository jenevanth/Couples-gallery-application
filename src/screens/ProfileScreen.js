import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
  BackHandler,
  Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import { format } from 'date-fns';

import { supabase } from '../services/supabase';
import { useTheme } from '../theme/ThemeContext';
import { launchImageLibrary } from 'react-native-image-picker';
import BlobUtil from 'react-native-blob-util';
import { COLORS } from '../theme/colors';
import Icon from 'react-native-vector-icons/Ionicons';

const log = (...a) => console.log('[Profile]', ...a);

// Use the SAME ImageKit public key as Camera/Gallery
const IMAGEKIT_PUBLIC_KEY = 'public_IAZdw7PGwJlYkHZC8/KN4/9TdRw=';

const ProfileScreen = ({ navigation }) => {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState('');

  // Profile fields
  const [email, setEmail] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [bio, setBio] = useState('');
  const [birthday, setBirthday] = useState(''); // yyyy-MM-dd or ''
  const [anniversary, setAnniversary] = useState(''); // yyyy-MM-dd or ''
  const [ourSong, setOurSong] = useState('');
  const [favoriteMemory, setFavoriteMemory] = useState('');

  // iOS inline date pickers
  const [showBirthdayPicker, setShowBirthdayPicker] = useState(false);
  const [showAnnivPicker, setShowAnnivPicker] = useState(false);

  // Back → Gallery tab on Android
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        navigation.navigate('MainTabs', { screen: 'Gallery' });
        return true;
      };
      const sub = BackHandler.addEventListener(
        'hardwareBackPress',
        onBackPress,
      );
      return () => sub.remove();
    }, [navigation]),
  );

  const ymd = d => format(d, 'yyyy-MM-dd');
  const ymdOrNow = str => {
    if (!str) return new Date();
    const [y, m, d] = str.split('-').map(Number);
    const dt = new Date(y, (m || 1) - 1, d || 1);
    return isNaN(dt.getTime()) ? new Date() : dt;
  };

  // Fetch profile (also when screen refocuses)
  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true);
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();
      if (userErr) log('getUser error:', userErr);
      if (!user) {
        setLoading(false);
        return;
      }
      setUserId(user.id);
      log('Auth user id:', user.id);

      const { data, error } = await supabase
        .from('profiles')
        .select(
          'email, avatar_url, name, nickname, bio, birthday, anniversary, our_song, favorite_memory',
        )
        .eq('id', user.id)
        .maybeSingle();

      if (error) log('Fetch error:', error);

      if (data) {
        setEmail(data.email || user.email || '');
        setAvatarUrl(data.avatar_url || '');
        setName(data.name || '');
        setNickname(data.nickname || '');
        setBio(data.bio || '');
        setBirthday(data.birthday || '');
        setAnniversary(data.anniversary || '');
        setOurSong(data.our_song || '');
        setFavoriteMemory(data.favorite_memory || '');
        log('Loaded profile row.');
      } else {
        // Create initial row so future upserts succeed (RLS expects id = auth.uid())
        const { error: insErr } = await supabase
          .from('profiles')
          .insert({ id: user.id, email: user.email || '' });
        if (insErr) log('Initial insert error (RLS?):', insErr);
        else log('Created initial profile row.');
        setEmail(user.email || '');
      }
    } catch (e) {
      log('Unexpected fetch error:', e);
      Alert.alert('Error', 'Something went wrong loading your profile.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  // Also re-fetch whenever this screen regains focus
  useFocusEffect(
    useCallback(() => {
      fetchProfile();
    }, [fetchProfile]),
  );

  const resolvePath = async uri => {
    try {
      const stat = await BlobUtil.fs.stat(uri);
      return stat?.path || uri.replace('file://', '');
    } catch {
      return uri.replace('file://', '');
    }
  };

  const handlePickAvatar = () => {
    launchImageLibrary(
      { mediaType: 'photo', selectionLimit: 1, quality: 0.9 },
      async response => {
        if (!response || response.didCancel || !response.assets?.length) return;
        const asset = response.assets[0];
        try {
          setSaving(true);

          // 1) ImageKit auth
          const sigRes = await fetch(
            'https://boyfriend-needs-backend.vercel.app/api/imagekit-auth',
          );
          if (!sigRes.ok)
            throw new Error('Could not authenticate with ImageKit.');
          const signatureData = await sigRes.json();
          log('Signature data:', signatureData);

          // 2) Build upload body
          const fileName =
            asset.fileName ||
            `avatar_${Date.now()}.${
              (asset.type || 'image/jpeg').split('/')[1] || 'jpg'
            }`;
          const pathToWrap = await resolvePath(asset.uri);
          const wrapped = BlobUtil.wrap(
            pathToWrap.startsWith('file://')
              ? pathToWrap.replace('file://', '')
              : pathToWrap,
          );

          const uploadData = [
            { name: 'file', filename: fileName, data: wrapped },
            { name: 'publicKey', data: IMAGEKIT_PUBLIC_KEY },
            { name: 'signature', data: signatureData.signature },
            { name: 'expire', data: String(signatureData.expire) },
            { name: 'token', data: signatureData.token },
            { name: 'fileName', data: fileName },
          ];

          // 3) Upload (BlobUtil first, fallback to FormData)
          let uploadUrl = '';
          try {
            const res = await BlobUtil.fetch(
              'POST',
              'https://upload.imagekit.io/api/v1/files/upload',
              {},
              uploadData,
            );
            const json = res.json();
            if (res.info().status >= 300)
              throw new Error(json?.message || 'ImageKit upload failed');
            uploadUrl = json.url;
            log('ImageKit upload success (BlobUtil):', uploadUrl);
          } catch (e) {
            log('BlobUtil upload failed, trying FormData:', e?.message || e);
            const data = new FormData();
            data.append('file', {
              uri: asset.uri,
              type: asset.type || 'image/jpeg',
              name: fileName,
            });
            data.append('publicKey', IMAGEKIT_PUBLIC_KEY);
            data.append('signature', signatureData.signature);
            data.append('expire', String(signatureData.expire));
            data.append('token', signatureData.token);
            data.append('fileName', fileName);
            const res = await fetch(
              'https://upload.imagekit.io/api/v1/files/upload',
              {
                method: 'POST',
                body: data,
                headers: { Accept: 'application/json' },
              },
            );
            const json = await res.json();
            if (!res.ok)
              throw new Error(
                json?.message || 'ImageKit upload failed (FormData)',
              );
            uploadUrl = json.url;
            log('ImageKit upload success (FormData):', uploadUrl);
          }

          // 4) Update state + persist + re-fetch to ensure UI matches DB
          setAvatarUrl(uploadUrl);

          if (userId) {
            const { error } = await supabase.from('profiles').upsert({
              id: userId,
              avatar_url: uploadUrl,
              updated_at: new Date().toISOString(),
            });
            if (error) {
              log('Avatar upsert error:', error);
              Alert.alert(
                'Save Warning',
                'Avatar uploaded but could not be saved. Check RLS policies.',
              );
            } else {
              log('Avatar URL saved to profiles.');
              await fetchProfile(); // refresh from DB so it sticks after navigation
            }
          }
        } catch (e) {
          log('Avatar upload error:', e);
          Alert.alert('Avatar Upload Error', e?.message || String(e));
        } finally {
          setSaving(false);
        }
      },
    );
  };

  const handleSave = async () => {
    try {
      setSaving(true);

      const birthdayVal = birthday?.trim() ? birthday : null;
      const anniversaryVal = anniversary?.trim() ? anniversary : null;

      const updates = {
        id: userId,
        name,
        nickname,
        avatar_url: avatarUrl,
        bio,
        birthday: birthdayVal,
        anniversary: anniversaryVal,
        our_song: ourSong,
        favorite_memory: favoriteMemory,
        email,
        updated_at: new Date().toISOString(),
      };
      log('Saving updates:', updates);

      const { error } = await supabase.from('profiles').upsert(updates);
      if (error) {
        log('Save error:', error);
        Alert.alert('Save Error', error.message);
      } else {
        Alert.alert('Success!', 'Your profile has been saved.');
        await fetchProfile(); // refresh after save
      }
    } catch (e) {
      log('Unexpected save error:', e);
      Alert.alert('Save Error', e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    console.log('[Profile] Signed out. Reset → ProfileSelector');
    navigation.reset({ index: 0, routes: [{ name: 'ProfileSelector' }] });
  };

  // Date pickers
  const openBirthdayPicker = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: ymdOrNow(birthday),
        onChange: (e, d) => d && setBirthday(ymd(d)),
        mode: 'date',
        is24Hour: true,
      });
    } else {
      setShowBirthdayPicker(true);
    }
  };
  const openAnnivPicker = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: ymdOrNow(anniversary),
        onChange: (e, d) => d && setAnniversary(ymd(d)),
        mode: 'date',
        is24Hour: true,
      });
    } else {
      setShowAnnivPicker(true);
    }
  };

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const headerBg =
    theme.name === 'pink' ? COLORS.pink.primary : COLORS.blue.primary;
  const bgSoft = theme.name === 'pink' ? COLORS.pink.light : COLORS.blue.light;

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: bgSoft }]}
      edges={['top', 'left', 'right']}
    >
      <ScrollView contentContainerStyle={styles.container}>
        {/* Hero Header */}
        <View style={[styles.hero, { backgroundColor: headerBg }]}>
          <View style={styles.heroRow}>
            <View style={[styles.avatarRing, { borderColor: '#fff' }]}>
              <TouchableOpacity
                onPress={handlePickAvatar}
                activeOpacity={0.8}
                style={styles.avatarClip}
              >
                <Image
                  source={
                    avatarUrl
                      ? { uri: avatarUrl }
                      : require('../assets/default-avatar.jpg')
                  }
                  style={styles.avatarImage}
                />
                <View style={styles.cameraBadge}>
                  <Icon name="camera" size={16} color="#fff" />
                </View>
              </TouchableOpacity>
            </View>

            <View style={{ flex: 1, marginLeft: 14 }}>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Your Name"
                placeholderTextColor="#ffffffcc"
                style={styles.heroName}
              />
              <TextInput
                value={nickname}
                onChangeText={setNickname}
                placeholder="I Love You❤️"
                placeholderTextColor="#ffffffaa"
                style={styles.heroNick}
              />
            </View>
          </View>
        </View>

        {/* About Me */}
        <View style={styles.card}>
          <Text style={[styles.cardHeader, { color: headerBg }]}>About Me</Text>

          <Text style={styles.label}>Email</Text>
          <TextInput
            value={email}
            editable={false}
            style={[styles.input, styles.disabledInput, { color: '#334155' }]}
          />

          <Text style={styles.label}>Bio</Text>
          <TextInput
            value={bio}
            onChangeText={setBio}
            style={[styles.input, styles.bioInput]}
            placeholder="A little about you..."
            placeholderTextColor="#9AA6B2"
            multiline
          />
        </View>

        {/* Key Dates */}
        <View style={styles.card}>
          <Text style={[styles.cardHeader, { color: headerBg }]}>
            Key Dates
          </Text>

          <Text style={styles.label}>Your Birthday</Text>
          <TouchableOpacity onPress={openBirthdayPicker} activeOpacity={0.7}>
            <View style={styles.dateInput}>
              <Icon name="calendar-outline" size={18} color="#64748b" />
              <Text style={styles.dateText}>{birthday || 'YYYY-MM-DD'}</Text>
            </View>
          </TouchableOpacity>

          <Text style={styles.label}>Our Anniversary</Text>
          <TouchableOpacity onPress={openAnnivPicker} activeOpacity={0.7}>
            <View style={styles.dateInput}>
              <Icon name="calendar-outline" size={18} color="#64748b" />
              <Text style={styles.dateText}>{anniversary || 'YYYY-MM-DD'}</Text>
            </View>
          </TouchableOpacity>

          {/* iOS inline pickers */}
          {showBirthdayPicker && Platform.OS === 'ios' && (
            <DateTimePicker
              value={ymdOrNow(birthday)}
              onChange={(e, d) => {
                if (d) setBirthday(ymd(d));
                setShowBirthdayPicker(false);
              }}
              mode="date"
              display="inline"
            />
          )}
          {showAnnivPicker && Platform.OS === 'ios' && (
            <DateTimePicker
              value={ymdOrNow(anniversary)}
              onChange={(e, d) => {
                if (d) setAnniversary(ymd(d));
                setShowAnnivPicker(false);
              }}
              mode="date"
              display="inline"
            />
          )}
        </View>

        {/* Our Favorites */}
        <View style={styles.card}>
          <Text style={[styles.cardHeader, { color: headerBg }]}>
            Our Favorites
          </Text>

          <Text style={styles.label}>Our Song</Text>
          <TextInput
            value={ourSong}
            onChangeText={setOurSong}
            style={styles.input}
            placeholder="The song that reminds you of them"
            placeholderTextColor="#9AA6B2"
          />

          <Text style={styles.label}>A Favorite Memory Together</Text>
          <TextInput
            value={favoriteMemory}
            onChangeText={setFavoriteMemory}
            style={[styles.input, styles.bioInput]}
            placeholder="Describe a favorite memory..."
            placeholderTextColor="#9AA6B2"
            multiline
          />
        </View>

        {/* Actions */}
        <TouchableOpacity
          style={[styles.saveButton, { backgroundColor: headerBg }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.9}
        >
          <Text style={styles.buttonText}>
            {saving ? 'Saving...' : 'Save Profile'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fdfdfd',
  },
  container: { padding: 16, paddingBottom: 40 },

  // Hero
  hero: {
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  heroRow: { flexDirection: 'row', alignItems: 'center' },
  avatarRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    backgroundColor: '#fff',
    padding: 2,
  },
  avatarClip: {
    width: '100%',
    height: '100%',
    borderRadius: 46,
    overflow: 'hidden',
    position: 'relative',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  cameraBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  heroName: { color: '#fff', fontSize: 22, fontWeight: '800' },
  heroNick: { color: '#f8fafc', opacity: 0.9, marginTop: 2, fontSize: 14 },

  // Cards
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3.0,
    elevation: 3,
  },
  cardHeader: { fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  label: { marginTop: 10, marginBottom: 4, color: '#555', fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fafafa',
    fontSize: 16,
    color: '#0f172a',
  },
  disabledInput: { backgroundColor: '#f0f0f0', color: '#888' },
  bioInput: { height: 90, textAlignVertical: 'top' },

  // Date inputs
  dateInput: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#fafafa',
  },
  dateText: { marginLeft: 8, color: '#0f172a', fontSize: 16 },

  // Actions
  saveButton: {
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 4,
    elevation: 2,
  },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  signOutButton: {
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#FF6347',
  },
  signOutText: { color: '#FF6347', fontWeight: 'bold', fontSize: 16 },
});

export default ProfileScreen;

// import React, { useState, useEffect, useCallback } from 'react';
// import {
//   View,
//   Text,
//   TextInput,
//   Image,
//   TouchableOpacity,
//   StyleSheet,
//   ActivityIndicator,
//   Alert,
//   ScrollView,
//   BackHandler,
// } from 'react-native';
// import { useFocusEffect } from '@react-navigation/native';
// import { SafeAreaView } from 'react-native-safe-area-context';

// import { supabase } from '../services/supabase';
// import { useTheme } from '../theme/ThemeContext';
// import { launchImageLibrary } from 'react-native-image-picker';
// import BlobUtil from 'react-native-blob-util';
// import { COLORS } from '../theme/colors';

// const IMAGEKIT_PUBLIC_KEY = 'public_Uv/iS0zY+r25MA3f2o5y/s+fG3M=';

// const ProfileScreen = ({ navigation }) => {
//   const { theme } = useTheme();
//   const [loading, setLoading] = useState(true);
//   const [saving, setSaving] = useState(false);
//   const [userId, setUserId] = useState('');

//   // State for all profile fields
//   const [email, setEmail] = useState('');
//   const [avatarUrl, setAvatarUrl] = useState('');
//   const [name, setName] = useState('');
//   const [nickname, setNickname] = useState('');
//   const [bio, setBio] = useState('');
//   const [birthday, setBirthday] = useState('');
//   const [anniversary, setAnniversary] = useState('');
//   const [ourSong, setOurSong] = useState('');
//   const [favoriteMemory, setFavoriteMemory] = useState('');

//   // Android hardware back: go to Gallery
//   useFocusEffect(
//     useCallback(() => {
//       const onBackPress = () => {
//         navigation.navigate('MainTabs', { screen: 'Gallery' });
//         return true;
//       };
//       const subscription = BackHandler.addEventListener(
//         'hardwareBackPress',
//         onBackPress,
//       );
//       return () => subscription.remove();
//     }, [navigation]),
//   );

//   // Fetch profile from Supabase
//   const fetchProfile = useCallback(async () => {
//     setLoading(true);
//     const {
//       data: { user },
//     } = await supabase.auth.getUser();
//     if (user) {
//       setUserId(user.id);
//       const { data, error } = await supabase
//         .from('profiles')
//         .select('*')
//         .eq('id', user.id)
//         .single();

//       if (error && error.code !== 'PGRST116') {
//         Alert.alert('Error', 'Could not fetch your profile.');
//         console.log('[ProfileScreen] Fetch error:', error);
//       } else if (data) {
//         setEmail(data.email || user.email);
//         setAvatarUrl(data.avatar_url || '');
//         setName(data.name || '');
//         setNickname(data.nickname || '');
//         setBio(data.bio || '');
//         setBirthday(data.birthday || '');
//         setAnniversary(data.anniversary || '');
//         setOurSong(data.our_song || '');
//         setFavoriteMemory(data.favorite_memory || '');
//         console.log('[ProfileScreen] Loaded profile:', data);
//       } else {
//         setEmail(user.email);
//         console.log('[ProfileScreen] No profile found, using defaults.');
//       }
//     }
//     setLoading(false);
//   }, []);

//   useEffect(() => {
//     fetchProfile();
//   }, [fetchProfile]);

//   // Pick and upload avatar
//   const handlePickAvatar = () => {
//     launchImageLibrary({ mediaType: 'photo' }, async response => {
//       if (
//         response.didCancel ||
//         !response.assets ||
//         response.assets.length === 0
//       )
//         return;
//       const asset = response.assets[0];
//       try {
//         setSaving(true);
//         // Check backend endpoint
//         const signatureRes = await fetch(
//           'https://boyfriend-needs-backend.vercel.app/api/imagekit-auth',
//         );
//         if (!signatureRes.ok)
//           throw new Error(
//             'Could not authenticate with ImageKit. Check your backend.',
//           );
//         const signatureData = await signatureRes.json();
//         if (!signatureData.signature)
//           throw new Error(
//             'Your account cannot be authenticated. (ImageKit signature missing)',
//           );
//         const uploadData = [
//           {
//             name: 'file',
//             filename: asset.fileName,
//             data: BlobUtil.wrap(asset.uri.replace('file://', '')),
//           },
//           { name: 'publicKey', data: IMAGEKIT_PUBLIC_KEY },
//           { name: 'signature', data: signatureData.signature },
//           { name: 'expire', data: String(signatureData.expire) },
//           { name: 'token', data: signatureData.token },
//           { name: 'fileName', data: asset.fileName },
//         ];
//         const task = BlobUtil.fetch(
//           'POST',
//           'https://upload.imagekit.io/api/v1/files/upload',
//           { 'Content-Type': 'multipart/form-data' },
//           uploadData,
//         );
//         const uploadResult = await task;
//         const resultJson = uploadResult.json();
//         if (uploadResult.info().status >= 300)
//           throw new Error(resultJson.message || 'ImageKit upload failed');
//         setAvatarUrl(resultJson.url);
//         console.log('[ProfileScreen] Avatar uploaded:', resultJson.url);
//       } catch (e) {
//         Alert.alert('Avatar Upload Error', e.message);
//         console.log('[ProfileScreen] Avatar upload error:', e);
//       }
//       setSaving(false);
//     });
//   };

//   // Save profile to Supabase
//   const handleSave = async () => {
//     setSaving(true);
//     const updates = {
//       id: userId,
//       name,
//       nickname,
//       avatar_url: avatarUrl,
//       bio,
//       birthday,
//       anniversary,
//       our_song: ourSong,
//       favorite_memory: favoriteMemory,
//       email,
//       updated_at: new Date().toISOString(),
//     };

//     const { error } = await supabase.from('profiles').upsert(updates);
//     if (error) {
//       Alert.alert('Save Error', error.message);
//       console.log('[ProfileScreen] Save error:', error);
//     } else {
//       Alert.alert('Success!', 'Your profile has been saved.');
//       console.log('[ProfileScreen] Profile saved:', updates);
//     }
//     setSaving(false);
//   };

//   const handleSignOut = async () => {
//     await supabase.auth.signOut();
//     navigation.reset({
//       index: 0,
//       routes: [{ name: 'ProfileSelector' }],
//     });
//   };

//   if (loading) {
//     return (
//       <View style={styles.loader}>
//         <ActivityIndicator size="large" color={theme.colors.primary} />
//       </View>
//     );
//   }

//   return (
//     <SafeAreaView
//       style={[
//         styles.safeArea,
//         {
//           backgroundColor:
//             theme.name === 'pink'
//               ? COLORS.pink.primary + '22'
//               : COLORS.blue.primary + '22',
//         },
//       ]}
//       edges={['top', 'left', 'right']}
//     >
//       <ScrollView contentContainerStyle={styles.container}>
//         {/* Header: Avatar + Name/Nickname */}
//         <View style={styles.headerRow}>
//           <TouchableOpacity
//             onPress={handlePickAvatar}
//             style={[
//               styles.avatarContainer,
//               { borderColor: theme.colors.primary },
//             ]}
//           >
//             <Image
//               source={
//                 avatarUrl
//                   ? { uri: avatarUrl }
//                   : require('../assets/default-avatar.jpg')
//               }
//               style={styles.avatar}
//             />
//           </TouchableOpacity>
//           <View style={styles.headerText}>
//             <TextInput
//               value={name}
//               onChangeText={setName}
//               placeholder="Your Name"
//               placeholderTextColor={theme.colors.primary + '99'}
//               style={[
//                 styles.nameInput,
//                 {
//                   color: theme.colors.primary,
//                   borderBottomColor: theme.colors.primary + '44',
//                 },
//               ]}
//             />
//             <TextInput
//               value={nickname}
//               onChangeText={setNickname}
//               placeholder="e.g. Bugaa Boo"
//               placeholderTextColor={theme.colors.primary + '66'}
//               style={[styles.nicknameInput, { color: theme.colors.primary }]}
//             />
//           </View>
//         </View>

//         {/* About Me */}
//         <View style={styles.card}>
//           <Text style={[styles.cardHeader, { color: theme.colors.primary }]}>
//             About Me
//           </Text>
//           <Text style={styles.label}>Email</Text>
//           <TextInput
//             value={email}
//             editable={false}
//             style={[
//               styles.input,
//               styles.disabledInput,
//               { color: theme.colors.primary },
//             ]}
//           />
//           <Text style={styles.label}>Bio</Text>
//           <TextInput
//             value={bio}
//             onChangeText={setBio}
//             style={[
//               styles.input,
//               styles.bioInput,
//               { color: theme.colors.primary },
//             ]}
//             placeholder="A little about you..."
//             placeholderTextColor={theme.colors.primary + '66'}
//             multiline
//           />
//         </View>

//         {/* Key Dates */}
//         <View style={styles.card}>
//           <Text style={[styles.cardHeader, { color: theme.colors.primary }]}>
//             Key Dates
//           </Text>
//           <Text style={styles.label}>Your Birthday</Text>
//           <TextInput
//             value={birthday}
//             onChangeText={setBirthday}
//             style={[styles.input, { color: theme.colors.primary }]}
//             placeholder="YYYY-MM-DD"
//             placeholderTextColor={theme.colors.primary + '66'}
//           />
//           <Text style={styles.label}>Our Anniversary</Text>
//           <TextInput
//             value={anniversary}
//             onChangeText={setAnniversary}
//             style={[styles.input, { color: theme.colors.primary }]}
//             placeholder="YYYY-MM-DD"
//             placeholderTextColor={theme.colors.primary + '66'}
//           />
//         </View>

//         {/* Our Favorites */}
//         <View style={styles.card}>
//           <Text style={[styles.cardHeader, { color: theme.colors.primary }]}>
//             Our Favorites
//           </Text>
//           <Text style={styles.label}>Our Song</Text>
//           <TextInput
//             value={ourSong}
//             onChangeText={setOurSong}
//             style={[styles.input, { color: theme.colors.primary }]}
//             placeholder="The song that reminds you of them"
//             placeholderTextColor={theme.colors.primary + '66'}
//           />
//           <Text style={styles.label}>A Favorite Memory Together</Text>
//           <TextInput
//             value={favoriteMemory}
//             onChangeText={setFavoriteMemory}
//             style={[
//               styles.input,
//               styles.bioInput,
//               { color: theme.colors.primary },
//             ]}
//             placeholder="Describe a favorite memory..."
//             placeholderTextColor={theme.colors.primary + '66'}
//             multiline
//           />
//         </View>

//         <TouchableOpacity
//           style={[styles.saveButton, { backgroundColor: theme.colors.primary }]}
//           onPress={handleSave}
//           disabled={saving}
//         >
//           <Text style={styles.buttonText}>
//             {saving ? 'Saving...' : 'Save Profile'}
//           </Text>
//         </TouchableOpacity>

//         <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
//           <Text style={styles.signOutText}>Sign Out</Text>
//         </TouchableOpacity>
//       </ScrollView>
//     </SafeAreaView>
//   );
// };

// const styles = StyleSheet.create({
//   safeArea: { flex: 1 },
//   loader: {
//     flex: 1,
//     justifyContent: 'center',
//     alignItems: 'center',
//     backgroundColor: '#fdfdfd',
//   },
//   container: { padding: 16, paddingBottom: 50 },
//   headerRow: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     marginBottom: 24,
//     paddingTop: 8,
//   },
//   avatarContainer: {
//     marginRight: 16,
//     borderWidth: 3,
//     borderRadius: 44,
//     padding: 2,
//     backgroundColor: '#fff',
//   },
//   avatar: {
//     width: 80,
//     height: 80,
//     borderRadius: 40,
//     backgroundColor: '#eee',
//   },
//   headerText: { flex: 1, justifyContent: 'center' },
//   nameInput: {
//     fontSize: 22,
//     fontWeight: 'bold',
//     borderBottomWidth: 1.5,
//     paddingBottom: 4,
//     marginBottom: 2,
//   },
//   nicknameInput: { fontSize: 16, marginTop: 2 },
//   card: {
//     backgroundColor: '#fff',
//     borderRadius: 12,
//     padding: 16,
//     marginBottom: 16,
//     shadowColor: '#000',
//     shadowOffset: { width: 0, height: 1 },
//     shadowOpacity: 0.1,
//     shadowRadius: 3.0,
//     elevation: 3,
//   },
//   cardHeader: { fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
//   label: { marginTop: 10, marginBottom: 4, color: '#555', fontWeight: '500' },
//   input: {
//     borderWidth: 1,
//     borderColor: '#ddd',
//     borderRadius: 8,
//     paddingHorizontal: 12,
//     paddingVertical: 10,
//     backgroundColor: '#fafafa',
//     fontSize: 16,
//   },
//   disabledInput: { backgroundColor: '#f0f0f0', color: '#888' },
//   bioInput: { height: 80, textAlignVertical: 'top' },
//   saveButton: {
//     padding: 15,
//     borderRadius: 10,
//     alignItems: 'center',
//     marginTop: 16,
//   },
//   buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
//   signOutButton: {
//     padding: 15,
//     borderRadius: 10,
//     alignItems: 'center',
//     marginTop: 12,
//     borderWidth: 1,
//     borderColor: '#FF6347',
//   },
//   signOutText: { color: '#FF6347', fontWeight: 'bold', fontSize: 16 },
// });

// export default ProfileScreen;
