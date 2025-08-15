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
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '../services/supabase';
import { useTheme } from '../theme/ThemeContext';
import { launchImageLibrary } from 'react-native-image-picker';
import BlobUtil from 'react-native-blob-util';
import { COLORS } from '../theme/colors';

const IMAGEKIT_PUBLIC_KEY = 'public_Uv/iS0zY+r25MA3f2o5y/s+fG3M=';

const ProfileScreen = ({ navigation }) => {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState('');

  // State for all profile fields
  const [email, setEmail] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [bio, setBio] = useState('');
  const [birthday, setBirthday] = useState('');
  const [anniversary, setAnniversary] = useState('');
  const [ourSong, setOurSong] = useState('');
  const [favoriteMemory, setFavoriteMemory] = useState('');

  // Android hardware back: go to Gallery
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        navigation.navigate('MainTabs', { screen: 'Gallery' });
        return true;
      };
      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        onBackPress,
      );
      return () => subscription.remove();
    }, [navigation]),
  );

  // Fetch profile from Supabase
  const fetchProfile = useCallback(async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      setUserId(user.id);
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        Alert.alert('Error', 'Could not fetch your profile.');
        console.log('[ProfileScreen] Fetch error:', error);
      } else if (data) {
        setEmail(data.email || user.email);
        setAvatarUrl(data.avatar_url || '');
        setName(data.name || '');
        setNickname(data.nickname || '');
        setBio(data.bio || '');
        setBirthday(data.birthday || '');
        setAnniversary(data.anniversary || '');
        setOurSong(data.our_song || '');
        setFavoriteMemory(data.favorite_memory || '');
        console.log('[ProfileScreen] Loaded profile:', data);
      } else {
        setEmail(user.email);
        console.log('[ProfileScreen] No profile found, using defaults.');
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  // Pick and upload avatar
  const handlePickAvatar = () => {
    launchImageLibrary({ mediaType: 'photo' }, async response => {
      if (
        response.didCancel ||
        !response.assets ||
        response.assets.length === 0
      )
        return;
      const asset = response.assets[0];
      try {
        setSaving(true);
        // Check backend endpoint
        const signatureRes = await fetch(
          'https://boyfriend-needs-backend.vercel.app/api/imagekit-auth',
        );
        if (!signatureRes.ok)
          throw new Error(
            'Could not authenticate with ImageKit. Check your backend.',
          );
        const signatureData = await signatureRes.json();
        if (!signatureData.signature)
          throw new Error(
            'Your account cannot be authenticated. (ImageKit signature missing)',
          );
        const uploadData = [
          {
            name: 'file',
            filename: asset.fileName,
            data: BlobUtil.wrap(asset.uri.replace('file://', '')),
          },
          { name: 'publicKey', data: IMAGEKIT_PUBLIC_KEY },
          { name: 'signature', data: signatureData.signature },
          { name: 'expire', data: String(signatureData.expire) },
          { name: 'token', data: signatureData.token },
          { name: 'fileName', data: asset.fileName },
        ];
        const task = BlobUtil.fetch(
          'POST',
          'https://upload.imagekit.io/api/v1/files/upload',
          { 'Content-Type': 'multipart/form-data' },
          uploadData,
        );
        const uploadResult = await task;
        const resultJson = uploadResult.json();
        if (uploadResult.info().status >= 300)
          throw new Error(resultJson.message || 'ImageKit upload failed');
        setAvatarUrl(resultJson.url);
        console.log('[ProfileScreen] Avatar uploaded:', resultJson.url);
      } catch (e) {
        Alert.alert('Avatar Upload Error', e.message);
        console.log('[ProfileScreen] Avatar upload error:', e);
      }
      setSaving(false);
    });
  };

  // Save profile to Supabase
  const handleSave = async () => {
    setSaving(true);
    const updates = {
      id: userId,
      name,
      nickname,
      avatar_url: avatarUrl,
      bio,
      birthday,
      anniversary,
      our_song: ourSong,
      favorite_memory: favoriteMemory,
      email,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('profiles').upsert(updates);
    if (error) {
      Alert.alert('Save Error', error.message);
      console.log('[ProfileScreen] Save error:', error);
    } else {
      Alert.alert('Success!', 'Your profile has been saved.');
      console.log('[ProfileScreen] Profile saved:', updates);
    }
    setSaving(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigation.reset({
      index: 0,
      routes: [{ name: 'ProfileSelector' }],
    });
  };

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView
      style={[
        styles.safeArea,
        {
          backgroundColor:
            theme.name === 'pink'
              ? COLORS.pink.primary + '22'
              : COLORS.blue.primary + '22',
        },
      ]}
      edges={['top', 'left', 'right']}
    >
      <ScrollView contentContainerStyle={styles.container}>
        {/* Header: Avatar + Name/Nickname */}
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={handlePickAvatar}
            style={[
              styles.avatarContainer,
              { borderColor: theme.colors.primary },
            ]}
          >
            <Image
              source={
                avatarUrl
                  ? { uri: avatarUrl }
                  : require('../assets/default-avatar.jpg')
              }
              style={styles.avatar}
            />
          </TouchableOpacity>
          <View style={styles.headerText}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Your Name"
              placeholderTextColor={theme.colors.primary + '99'}
              style={[
                styles.nameInput,
                {
                  color: theme.colors.primary,
                  borderBottomColor: theme.colors.primary + '44',
                },
              ]}
            />
            <TextInput
              value={nickname}
              onChangeText={setNickname}
              placeholder="e.g. Bugaa Boo"
              placeholderTextColor={theme.colors.primary + '66'}
              style={[styles.nicknameInput, { color: theme.colors.primary }]}
            />
          </View>
        </View>

        {/* About Me */}
        <View style={styles.card}>
          <Text style={[styles.cardHeader, { color: theme.colors.primary }]}>
            About Me
          </Text>
          <Text style={styles.label}>Email</Text>
          <TextInput
            value={email}
            editable={false}
            style={[
              styles.input,
              styles.disabledInput,
              { color: theme.colors.primary },
            ]}
          />
          <Text style={styles.label}>Bio</Text>
          <TextInput
            value={bio}
            onChangeText={setBio}
            style={[
              styles.input,
              styles.bioInput,
              { color: theme.colors.primary },
            ]}
            placeholder="A little about you..."
            placeholderTextColor={theme.colors.primary + '66'}
            multiline
          />
        </View>

        {/* Key Dates */}
        <View style={styles.card}>
          <Text style={[styles.cardHeader, { color: theme.colors.primary }]}>
            Key Dates
          </Text>
          <Text style={styles.label}>Your Birthday</Text>
          <TextInput
            value={birthday}
            onChangeText={setBirthday}
            style={[styles.input, { color: theme.colors.primary }]}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={theme.colors.primary + '66'}
          />
          <Text style={styles.label}>Our Anniversary</Text>
          <TextInput
            value={anniversary}
            onChangeText={setAnniversary}
            style={[styles.input, { color: theme.colors.primary }]}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={theme.colors.primary + '66'}
          />
        </View>

        {/* Our Favorites */}
        <View style={styles.card}>
          <Text style={[styles.cardHeader, { color: theme.colors.primary }]}>
            Our Favorites
          </Text>
          <Text style={styles.label}>Our Song</Text>
          <TextInput
            value={ourSong}
            onChangeText={setOurSong}
            style={[styles.input, { color: theme.colors.primary }]}
            placeholder="The song that reminds you of them"
            placeholderTextColor={theme.colors.primary + '66'}
          />
          <Text style={styles.label}>A Favorite Memory Together</Text>
          <TextInput
            value={favoriteMemory}
            onChangeText={setFavoriteMemory}
            style={[
              styles.input,
              styles.bioInput,
              { color: theme.colors.primary },
            ]}
            placeholder="Describe a favorite memory..."
            placeholderTextColor={theme.colors.primary + '66'}
            multiline
          />
        </View>

        <TouchableOpacity
          style={[styles.saveButton, { backgroundColor: theme.colors.primary }]}
          onPress={handleSave}
          disabled={saving}
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
  container: { padding: 16, paddingBottom: 50 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    paddingTop: 8,
  },
  avatarContainer: {
    marginRight: 16,
    borderWidth: 3,
    borderRadius: 44,
    padding: 2,
    backgroundColor: '#fff',
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#eee',
  },
  headerText: { flex: 1, justifyContent: 'center' },
  nameInput: {
    fontSize: 22,
    fontWeight: 'bold',
    borderBottomWidth: 1.5,
    paddingBottom: 4,
    marginBottom: 2,
  },
  nicknameInput: { fontSize: 16, marginTop: 2 },
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
  label: { marginTop: 10, marginBottom: 4, color: '#555', fontWeight: '500' },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fafafa',
    fontSize: 16,
  },
  disabledInput: { backgroundColor: '#f0f0f0', color: '#888' },
  bioInput: { height: 80, textAlignVertical: 'top' },
  saveButton: {
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 16,
  },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  signOutButton: {
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#FF6347',
  },
  signOutText: { color: '#FF6347', fontWeight: 'bold', fontSize: 16 },
});

export default ProfileScreen;
