// ProfileScreen.js
import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Animated,
  Dimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';

import { supabase } from '../services/supabase';
import { useTheme } from '../theme/ThemeContext';
import { launchImageLibrary } from 'react-native-image-picker';
import BlobUtil from 'react-native-blob-util';

const log = (...a) => console.log('[Profile]', ...a);

// Use the SAME ImageKit public key as Camera/Gallery
const IMAGEKIT_PUBLIC_KEY = 'public_IAZdw7PGwJlYkHZC8/KN4/9TdRw=';

const { width } = Dimensions.get('window');

const ProfileScreen = ({ navigation }) => {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState('');

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;

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

  // Start animations
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 4,
        tension: 40,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.05,
            duration: 1500,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1500,
            useNativeDriver: true,
          }),
        ]),
      ).start(),
    ]).start();
  }, []);

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
      <LinearGradient
        colors={
          theme.gradient || [theme.colors.primary, theme.colors.secondary]
        }
        style={styles.loader}
      >
        <ActivityIndicator size="large" color="#FFFFFF" />
        <Text style={styles.loadingText}>Loading your profile...</Text>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient
      colors={[theme.colors.ultraLight, '#FFFFFF', theme.colors.light]}
      style={styles.container}
    >
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Hero Section */}
          <Animated.View
            style={[
              styles.heroWrapper,
              {
                opacity: fadeAnim,
                transform: [{ translateY: slideAnim }],
              },
            ]}
          >
            <LinearGradient
              colors={
                theme.gradient || [theme.colors.primary, theme.colors.secondary]
              }
              style={styles.hero}
            >
              {/* Decorative circles */}
              <View style={[styles.decorCircle, styles.decorCircle1]} />
              <View style={[styles.decorCircle, styles.decorCircle2]} />

              <View style={styles.heroContent}>
                {/* Avatar Section */}
                <TouchableOpacity
                  onPress={handlePickAvatar}
                  activeOpacity={0.9}
                  style={styles.avatarContainer}
                >
                  <Animated.View
                    style={[
                      styles.avatarWrapper,
                      { transform: [{ scale: pulseAnim }] },
                    ]}
                  >
                    <LinearGradient
                      colors={['#FFFFFF', theme.colors.ultraLight]}
                      style={styles.avatarGradient}
                    >
                      <Image
                        source={
                          avatarUrl
                            ? { uri: avatarUrl }
                            : require('../assets/default-avatar.jpg')
                        }
                        style={styles.avatarImage}
                      />
                    </LinearGradient>
                    <LinearGradient
                      colors={[theme.shared.purple, theme.shared.orange]}
                      style={styles.cameraBadge}
                    >
                      <Icon name="camera" size={20} color="#FFFFFF" />
                    </LinearGradient>
                  </Animated.View>
                </TouchableOpacity>

                {/* Name Section */}
                <View style={styles.nameSection}>
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    placeholder="Your Name"
                    placeholderTextColor="rgba(255,255,255,0.7)"
                    style={styles.heroName}
                  />
                  <View style={styles.nicknameContainer}>
                    <Icon name="heart" size={16} color="#FFFFFF" />
                    <TextInput
                      value={nickname}
                      onChangeText={setNickname}
                      placeholder="Love nickname"
                      placeholderTextColor="rgba(255,255,255,0.6)"
                      style={styles.heroNickname}
                    />
                  </View>
                </View>
              </View>

              {/* Stats Row */}
              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Icon name="calendar" size={20} color="#FFFFFF" />
                  <Text style={styles.statLabel}>Member Since</Text>
                  <Text style={styles.statValue}>
                    {format(new Date(), 'MMM yyyy')}
                  </Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statItem}>
                  <Icon name="images" size={20} color="#FFFFFF" />
                  <Text style={styles.statLabel}>Memories</Text>
                  <Text style={styles.statValue}>♾️</Text>
                </View>
              </View>
            </LinearGradient>
          </Animated.View>

          {/* About Me Card */}
          <Animated.View
            style={[
              styles.card,
              {
                opacity: fadeAnim,
                transform: [{ scale: scaleAnim }],
              },
            ]}
          >
            <LinearGradient
              colors={[theme.colors.primary + '10', 'transparent']}
              style={styles.cardGradient}
            >
              <View style={styles.cardHeader}>
                <View
                  style={[
                    styles.cardIcon,
                    { backgroundColor: theme.colors.primary + '20' },
                  ]}
                >
                  <Icon name="person" size={20} color={theme.colors.primary} />
                </View>
                <Text
                  style={[styles.cardTitle, { color: theme.colors.primary }]}
                >
                  About Me
                </Text>
              </View>

              <View style={styles.inputGroup}>
                <Text
                  style={[
                    styles.label,
                    { color: theme.colors.dark || theme.colors.primary },
                  ]}
                >
                  Email
                </Text>
                <View style={[styles.inputWrapper, styles.disabledWrapper]}>
                  <Icon name="mail-outline" size={18} color={theme.gray.dark} />
                  <TextInput
                    value={email}
                    editable={false}
                    style={[styles.input, styles.disabledInput]}
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text
                  style={[
                    styles.label,
                    { color: theme.colors.dark || theme.colors.primary },
                  ]}
                >
                  Bio
                </Text>
                <View style={[styles.inputWrapper, styles.textAreaWrapper]}>
                  <TextInput
                    value={bio}
                    onChangeText={setBio}
                    style={[styles.input, styles.textArea]}
                    placeholder="Tell your story..."
                    placeholderTextColor={theme.gray.medium}
                    multiline
                  />
                </View>
              </View>
            </LinearGradient>
          </Animated.View>

          {/* Key Dates Card */}
          <Animated.View
            style={[
              styles.card,
              {
                opacity: fadeAnim,
                transform: [{ scale: scaleAnim }],
              },
            ]}
          >
            <LinearGradient
              colors={[theme.shared.yellow + '10', 'transparent']}
              style={styles.cardGradient}
            >
              <View style={styles.cardHeader}>
                <View
                  style={[
                    styles.cardIcon,
                    { backgroundColor: theme.shared.yellow + '20' },
                  ]}
                >
                  <Icon
                    name="calendar-outline"
                    size={20}
                    color={theme.shared.yellow}
                  />
                </View>
                <Text
                  style={[styles.cardTitle, { color: theme.colors.primary }]}
                >
                  Special Dates
                </Text>
              </View>

              <View style={styles.inputGroup}>
                <Text
                  style={[
                    styles.label,
                    { color: theme.colors.dark || theme.colors.primary },
                  ]}
                >
                  🎂 Your Birthday
                </Text>
                <TouchableOpacity
                  onPress={openBirthdayPicker}
                  activeOpacity={0.7}
                >
                  <LinearGradient
                    colors={[theme.colors.light, theme.colors.ultraLight]}
                    style={styles.dateButton}
                  >
                    <Icon name="gift" size={18} color={theme.colors.primary} />
                    <Text
                      style={[styles.dateText, { color: theme.colors.primary }]}
                    >
                      {birthday || 'Select your birthday'}
                    </Text>
                    <Icon
                      name="chevron-forward"
                      size={18}
                      color={theme.colors.primary}
                    />
                  </LinearGradient>
                </TouchableOpacity>
              </View>

              <View style={styles.inputGroup}>
                <Text
                  style={[
                    styles.label,
                    { color: theme.colors.dark || theme.colors.primary },
                  ]}
                >
                  💕 Our Anniversary
                </Text>
                <TouchableOpacity onPress={openAnnivPicker} activeOpacity={0.7}>
                  <LinearGradient
                    colors={[theme.shared.red + '10', theme.shared.red + '05']}
                    style={styles.dateButton}
                  >
                    <Icon name="heart" size={18} color={theme.shared.red} />
                    <Text
                      style={[styles.dateText, { color: theme.shared.red }]}
                    >
                      {anniversary || 'Select anniversary'}
                    </Text>
                    <Icon
                      name="chevron-forward"
                      size={18}
                      color={theme.shared.red}
                    />
                  </LinearGradient>
                </TouchableOpacity>
              </View>

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
            </LinearGradient>
          </Animated.View>

          {/* Our Favorites Card */}
          <Animated.View
            style={[
              styles.card,
              {
                opacity: fadeAnim,
                transform: [{ scale: scaleAnim }],
              },
            ]}
          >
            <LinearGradient
              colors={[theme.shared.purple + '10', 'transparent']}
              style={styles.cardGradient}
            >
              <View style={styles.cardHeader}>
                <View
                  style={[
                    styles.cardIcon,
                    { backgroundColor: theme.shared.purple + '20' },
                  ]}
                >
                  <Icon name="star" size={20} color={theme.shared.purple} />
                </View>
                <Text
                  style={[styles.cardTitle, { color: theme.colors.primary }]}
                >
                  Our Favorites
                </Text>
              </View>

              <View style={styles.inputGroup}>
                <Text
                  style={[
                    styles.label,
                    { color: theme.colors.dark || theme.colors.primary },
                  ]}
                >
                  🎵 Our Song
                </Text>
                <View style={styles.inputWrapper}>
                  <Icon
                    name="musical-notes"
                    size={18}
                    color={theme.shared.purple}
                  />
                  <TextInput
                    value={ourSong}
                    onChangeText={setOurSong}
                    style={styles.input}
                    placeholder="The melody of our love"
                    placeholderTextColor={theme.gray.medium}
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text
                  style={[
                    styles.label,
                    { color: theme.colors.dark || theme.colors.primary },
                  ]}
                >
                  ✨ Favorite Memory
                </Text>
                <View style={[styles.inputWrapper, styles.textAreaWrapper]}>
                  <TextInput
                    value={favoriteMemory}
                    onChangeText={setFavoriteMemory}
                    style={[styles.input, styles.textArea]}
                    placeholder="A moment to treasure forever..."
                    placeholderTextColor={theme.gray.medium}
                    multiline
                  />
                </View>
              </View>
            </LinearGradient>
          </Animated.View>

          {/* Action Buttons */}
          <Animated.View
            style={[
              styles.actions,
              {
                opacity: fadeAnim,
                transform: [{ scale: scaleAnim }],
              },
            ]}
          >
            <TouchableOpacity
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.9}
            >
              <LinearGradient
                colors={
                  theme.gradient || [
                    theme.colors.primary,
                    theme.colors.secondary,
                  ]
                }
                style={styles.saveButton}
              >
                {saving ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Icon name="checkmark-circle" size={24} color="#FFFFFF" />
                )}
                <Text style={styles.saveButtonText}>
                  {saving ? 'Saving...' : 'Save Profile'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleSignOut}
              activeOpacity={0.7}
              style={styles.signOutButton}
            >
              <Icon name="log-out-outline" size={24} color={theme.shared.red} />
              <Text style={[styles.signOutText, { color: theme.shared.red }]}>
                Sign Out
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#FFFFFF',
    fontSize: 18,
    marginTop: 16,
    fontWeight: '600',
  },

  // Hero Section
  heroWrapper: {
    marginBottom: 20,
  },
  hero: {
    paddingTop: 30,
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    position: 'relative',
    overflow: 'hidden',
  },
  decorCircle: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 100,
  },
  decorCircle1: {
    width: 150,
    height: 150,
    top: -75,
    right: -75,
  },
  decorCircle2: {
    width: 100,
    height: 100,
    bottom: -50,
    left: -50,
  },
  heroContent: {
    alignItems: 'center',
    marginBottom: 20,
  },
  avatarContainer: {
    marginBottom: 20,
  },
  avatarWrapper: {
    position: 'relative',
  },
  avatarGradient: {
    width: 120,
    height: 120,
    borderRadius: 60,
    padding: 3,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 57,
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 5,
    right: 5,
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  nameSection: {
    alignItems: 'center',
  },
  heroName: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 8,
  },
  nicknameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  heroNickname: {
    color: '#FFFFFF',
    fontSize: 16,
    marginLeft: 8,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 20,
    padding: 15,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statLabel: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 12,
    marginTop: 4,
  },
  statValue: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    marginHorizontal: 20,
  },

  // Cards
  card: {
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  cardGradient: {
    borderRadius: 20,
    padding: 20,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },

  // Inputs
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 15,
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.05)',
  },
  textAreaWrapper: {
    alignItems: 'flex-start',
    paddingVertical: 15,
  },
  input: {
    flex: 1,
    marginLeft: 10,
    fontSize: 16,
    color: '#333',
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
    marginLeft: 0,
  },
  disabledWrapper: {
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
  },
  disabledInput: {
    color: '#666',
  },

  // Date Buttons
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.05)',
  },
  dateText: {
    flex: 1,
    marginLeft: 12,
    fontSize: 16,
    fontWeight: '500',
  },

  // Actions
  actions: {
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 30,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 25,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 10,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    marginTop: 12,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: 'rgba(230, 57, 70, 0.3)',
    backgroundColor: 'rgba(230, 57, 70, 0.05)',
  },
  signOutText: {
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 10,
  },
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
//   Platform,
// } from 'react-native';
// import { useFocusEffect } from '@react-navigation/native';
// import { SafeAreaView } from 'react-native-safe-area-context';
// import DateTimePicker, {
//   DateTimePickerAndroid,
// } from '@react-native-community/datetimepicker';
// import { format } from 'date-fns';

// import { supabase } from '../services/supabase';
// import { useTheme } from '../theme/ThemeContext';
// import { launchImageLibrary } from 'react-native-image-picker';
// import BlobUtil from 'react-native-blob-util';
// import { COLORS } from '../theme/colors';
// import Icon from 'react-native-vector-icons/Ionicons';

// const log = (...a) => console.log('[Profile]', ...a);

// // Use the SAME ImageKit public key as Camera/Gallery
// const IMAGEKIT_PUBLIC_KEY = 'public_IAZdw7PGwJlYkHZC8/KN4/9TdRw=';

// const ProfileScreen = ({ navigation }) => {
//   const { theme } = useTheme();
//   const [loading, setLoading] = useState(true);
//   const [saving, setSaving] = useState(false);
//   const [userId, setUserId] = useState('');

//   // Profile fields
//   const [email, setEmail] = useState('');
//   const [avatarUrl, setAvatarUrl] = useState('');
//   const [name, setName] = useState('');
//   const [nickname, setNickname] = useState('');
//   const [bio, setBio] = useState('');
//   const [birthday, setBirthday] = useState(''); // yyyy-MM-dd or ''
//   const [anniversary, setAnniversary] = useState(''); // yyyy-MM-dd or ''
//   const [ourSong, setOurSong] = useState('');
//   const [favoriteMemory, setFavoriteMemory] = useState('');

//   // iOS inline date pickers
//   const [showBirthdayPicker, setShowBirthdayPicker] = useState(false);
//   const [showAnnivPicker, setShowAnnivPicker] = useState(false);

//   // Back → Gallery tab on Android
//   useFocusEffect(
//     useCallback(() => {
//       const onBackPress = () => {
//         navigation.navigate('MainTabs', { screen: 'Gallery' });
//         return true;
//       };
//       const sub = BackHandler.addEventListener(
//         'hardwareBackPress',
//         onBackPress,
//       );
//       return () => sub.remove();
//     }, [navigation]),
//   );

//   const ymd = d => format(d, 'yyyy-MM-dd');
//   const ymdOrNow = str => {
//     if (!str) return new Date();
//     const [y, m, d] = str.split('-').map(Number);
//     const dt = new Date(y, (m || 1) - 1, d || 1);
//     return isNaN(dt.getTime()) ? new Date() : dt;
//   };

//   // Fetch profile (also when screen refocuses)
//   const fetchProfile = useCallback(async () => {
//     try {
//       setLoading(true);
//       const {
//         data: { user },
//         error: userErr,
//       } = await supabase.auth.getUser();
//       if (userErr) log('getUser error:', userErr);
//       if (!user) {
//         setLoading(false);
//         return;
//       }
//       setUserId(user.id);
//       log('Auth user id:', user.id);

//       const { data, error } = await supabase
//         .from('profiles')
//         .select(
//           'email, avatar_url, name, nickname, bio, birthday, anniversary, our_song, favorite_memory',
//         )
//         .eq('id', user.id)
//         .maybeSingle();

//       if (error) log('Fetch error:', error);

//       if (data) {
//         setEmail(data.email || user.email || '');
//         setAvatarUrl(data.avatar_url || '');
//         setName(data.name || '');
//         setNickname(data.nickname || '');
//         setBio(data.bio || '');
//         setBirthday(data.birthday || '');
//         setAnniversary(data.anniversary || '');
//         setOurSong(data.our_song || '');
//         setFavoriteMemory(data.favorite_memory || '');
//         log('Loaded profile row.');
//       } else {
//         // Create initial row so future upserts succeed (RLS expects id = auth.uid())
//         const { error: insErr } = await supabase
//           .from('profiles')
//           .insert({ id: user.id, email: user.email || '' });
//         if (insErr) log('Initial insert error (RLS?):', insErr);
//         else log('Created initial profile row.');
//         setEmail(user.email || '');
//       }
//     } catch (e) {
//       log('Unexpected fetch error:', e);
//       Alert.alert('Error', 'Something went wrong loading your profile.');
//     } finally {
//       setLoading(false);
//     }
//   }, []);

//   useEffect(() => {
//     fetchProfile();
//   }, [fetchProfile]);

//   // Also re-fetch whenever this screen regains focus
//   useFocusEffect(
//     useCallback(() => {
//       fetchProfile();
//     }, [fetchProfile]),
//   );

//   const resolvePath = async uri => {
//     try {
//       const stat = await BlobUtil.fs.stat(uri);
//       return stat?.path || uri.replace('file://', '');
//     } catch {
//       return uri.replace('file://', '');
//     }
//   };

//   const handlePickAvatar = () => {
//     launchImageLibrary(
//       { mediaType: 'photo', selectionLimit: 1, quality: 0.9 },
//       async response => {
//         if (!response || response.didCancel || !response.assets?.length) return;
//         const asset = response.assets[0];
//         try {
//           setSaving(true);

//           // 1) ImageKit auth
//           const sigRes = await fetch(
//             'https://boyfriend-needs-backend.vercel.app/api/imagekit-auth',
//           );
//           if (!sigRes.ok)
//             throw new Error('Could not authenticate with ImageKit.');
//           const signatureData = await sigRes.json();
//           log('Signature data:', signatureData);

//           // 2) Build upload body
//           const fileName =
//             asset.fileName ||
//             `avatar_${Date.now()}.${
//               (asset.type || 'image/jpeg').split('/')[1] || 'jpg'
//             }`;
//           const pathToWrap = await resolvePath(asset.uri);
//           const wrapped = BlobUtil.wrap(
//             pathToWrap.startsWith('file://')
//               ? pathToWrap.replace('file://', '')
//               : pathToWrap,
//           );

//           const uploadData = [
//             { name: 'file', filename: fileName, data: wrapped },
//             { name: 'publicKey', data: IMAGEKIT_PUBLIC_KEY },
//             { name: 'signature', data: signatureData.signature },
//             { name: 'expire', data: String(signatureData.expire) },
//             { name: 'token', data: signatureData.token },
//             { name: 'fileName', data: fileName },
//           ];

//           // 3) Upload (BlobUtil first, fallback to FormData)
//           let uploadUrl = '';
//           try {
//             const res = await BlobUtil.fetch(
//               'POST',
//               'https://upload.imagekit.io/api/v1/files/upload',
//               {},
//               uploadData,
//             );
//             const json = res.json();
//             if (res.info().status >= 300)
//               throw new Error(json?.message || 'ImageKit upload failed');
//             uploadUrl = json.url;
//             log('ImageKit upload success (BlobUtil):', uploadUrl);
//           } catch (e) {
//             log('BlobUtil upload failed, trying FormData:', e?.message || e);
//             const data = new FormData();
//             data.append('file', {
//               uri: asset.uri,
//               type: asset.type || 'image/jpeg',
//               name: fileName,
//             });
//             data.append('publicKey', IMAGEKIT_PUBLIC_KEY);
//             data.append('signature', signatureData.signature);
//             data.append('expire', String(signatureData.expire));
//             data.append('token', signatureData.token);
//             data.append('fileName', fileName);
//             const res = await fetch(
//               'https://upload.imagekit.io/api/v1/files/upload',
//               {
//                 method: 'POST',
//                 body: data,
//                 headers: { Accept: 'application/json' },
//               },
//             );
//             const json = await res.json();
//             if (!res.ok)
//               throw new Error(
//                 json?.message || 'ImageKit upload failed (FormData)',
//               );
//             uploadUrl = json.url;
//             log('ImageKit upload success (FormData):', uploadUrl);
//           }

//           // 4) Update state + persist + re-fetch to ensure UI matches DB
//           setAvatarUrl(uploadUrl);

//           if (userId) {
//             const { error } = await supabase.from('profiles').upsert({
//               id: userId,
//               avatar_url: uploadUrl,
//               updated_at: new Date().toISOString(),
//             });
//             if (error) {
//               log('Avatar upsert error:', error);
//               Alert.alert(
//                 'Save Warning',
//                 'Avatar uploaded but could not be saved. Check RLS policies.',
//               );
//             } else {
//               log('Avatar URL saved to profiles.');
//               await fetchProfile(); // refresh from DB so it sticks after navigation
//             }
//           }
//         } catch (e) {
//           log('Avatar upload error:', e);
//           Alert.alert('Avatar Upload Error', e?.message || String(e));
//         } finally {
//           setSaving(false);
//         }
//       },
//     );
//   };

//   const handleSave = async () => {
//     try {
//       setSaving(true);

//       const birthdayVal = birthday?.trim() ? birthday : null;
//       const anniversaryVal = anniversary?.trim() ? anniversary : null;

//       const updates = {
//         id: userId,
//         name,
//         nickname,
//         avatar_url: avatarUrl,
//         bio,
//         birthday: birthdayVal,
//         anniversary: anniversaryVal,
//         our_song: ourSong,
//         favorite_memory: favoriteMemory,
//         email,
//         updated_at: new Date().toISOString(),
//       };
//       log('Saving updates:', updates);

//       const { error } = await supabase.from('profiles').upsert(updates);
//       if (error) {
//         log('Save error:', error);
//         Alert.alert('Save Error', error.message);
//       } else {
//         Alert.alert('Success!', 'Your profile has been saved.');
//         await fetchProfile(); // refresh after save
//       }
//     } catch (e) {
//       log('Unexpected save error:', e);
//       Alert.alert('Save Error', e?.message || String(e));
//     } finally {
//       setSaving(false);
//     }
//   };

//   const handleSignOut = async () => {
//     await supabase.auth.signOut();
//     console.log('[Profile] Signed out. Reset → ProfileSelector');
//     navigation.reset({ index: 0, routes: [{ name: 'ProfileSelector' }] });
//   };

//   // Date pickers
//   const openBirthdayPicker = () => {
//     if (Platform.OS === 'android') {
//       DateTimePickerAndroid.open({
//         value: ymdOrNow(birthday),
//         onChange: (e, d) => d && setBirthday(ymd(d)),
//         mode: 'date',
//         is24Hour: true,
//       });
//     } else {
//       setShowBirthdayPicker(true);
//     }
//   };
//   const openAnnivPicker = () => {
//     if (Platform.OS === 'android') {
//       DateTimePickerAndroid.open({
//         value: ymdOrNow(anniversary),
//         onChange: (e, d) => d && setAnniversary(ymd(d)),
//         mode: 'date',
//         is24Hour: true,
//       });
//     } else {
//       setShowAnnivPicker(true);
//     }
//   };

//   if (loading) {
//     return (
//       <View style={styles.loader}>
//         <ActivityIndicator size="large" color={theme.colors.primary} />
//       </View>
//     );
//   }

//   const headerBg =
//     theme.name === 'pink' ? COLORS.pink.primary : COLORS.blue.primary;
//   const bgSoft = theme.name === 'pink' ? COLORS.pink.light : COLORS.blue.light;

//   return (
//     <SafeAreaView
//       style={[styles.safeArea, { backgroundColor: bgSoft }]}
//       edges={['top', 'left', 'right']}
//     >
//       <ScrollView contentContainerStyle={styles.container}>
//         {/* Hero Header */}
//         <View style={[styles.hero, { backgroundColor: headerBg }]}>
//           <View style={styles.heroRow}>
//             <View style={[styles.avatarRing, { borderColor: '#fff' }]}>
//               <TouchableOpacity
//                 onPress={handlePickAvatar}
//                 activeOpacity={0.8}
//                 style={styles.avatarClip}
//               >
//                 <Image
//                   source={
//                     avatarUrl
//                       ? { uri: avatarUrl }
//                       : require('../assets/default-avatar.jpg')
//                   }
//                   style={styles.avatarImage}
//                 />
//                 <View style={styles.cameraBadge}>
//                   <Icon name="camera" size={16} color="#fff" />
//                 </View>
//               </TouchableOpacity>
//             </View>

//             <View style={{ flex: 1, marginLeft: 14 }}>
//               <TextInput
//                 value={name}
//                 onChangeText={setName}
//                 placeholder="Your Name"
//                 placeholderTextColor="#ffffffcc"
//                 style={styles.heroName}
//               />
//               <TextInput
//                 value={nickname}
//                 onChangeText={setNickname}
//                 placeholder="I Love You❤️"
//                 placeholderTextColor="#ffffffaa"
//                 style={styles.heroNick}
//               />
//             </View>
//           </View>
//         </View>

//         {/* About Me */}
//         <View style={styles.card}>
//           <Text style={[styles.cardHeader, { color: headerBg }]}>About Me</Text>

//           <Text style={styles.label}>Email</Text>
//           <TextInput
//             value={email}
//             editable={false}
//             style={[styles.input, styles.disabledInput, { color: '#334155' }]}
//           />

//           <Text style={styles.label}>Bio</Text>
//           <TextInput
//             value={bio}
//             onChangeText={setBio}
//             style={[styles.input, styles.bioInput]}
//             placeholder="A little about you..."
//             placeholderTextColor="#9AA6B2"
//             multiline
//           />
//         </View>

//         {/* Key Dates */}
//         <View style={styles.card}>
//           <Text style={[styles.cardHeader, { color: headerBg }]}>
//             Key Dates
//           </Text>

//           <Text style={styles.label}>Your Birthday</Text>
//           <TouchableOpacity onPress={openBirthdayPicker} activeOpacity={0.7}>
//             <View style={styles.dateInput}>
//               <Icon name="calendar-outline" size={18} color="#64748b" />
//               <Text style={styles.dateText}>{birthday || 'YYYY-MM-DD'}</Text>
//             </View>
//           </TouchableOpacity>

//           <Text style={styles.label}>Our Anniversary</Text>
//           <TouchableOpacity onPress={openAnnivPicker} activeOpacity={0.7}>
//             <View style={styles.dateInput}>
//               <Icon name="calendar-outline" size={18} color="#64748b" />
//               <Text style={styles.dateText}>{anniversary || 'YYYY-MM-DD'}</Text>
//             </View>
//           </TouchableOpacity>

//           {/* iOS inline pickers */}
//           {showBirthdayPicker && Platform.OS === 'ios' && (
//             <DateTimePicker
//               value={ymdOrNow(birthday)}
//               onChange={(e, d) => {
//                 if (d) setBirthday(ymd(d));
//                 setShowBirthdayPicker(false);
//               }}
//               mode="date"
//               display="inline"
//             />
//           )}
//           {showAnnivPicker && Platform.OS === 'ios' && (
//             <DateTimePicker
//               value={ymdOrNow(anniversary)}
//               onChange={(e, d) => {
//                 if (d) setAnniversary(ymd(d));
//                 setShowAnnivPicker(false);
//               }}
//               mode="date"
//               display="inline"
//             />
//           )}
//         </View>

//         {/* Our Favorites */}
//         <View style={styles.card}>
//           <Text style={[styles.cardHeader, { color: headerBg }]}>
//             Our Favorites
//           </Text>

//           <Text style={styles.label}>Our Song</Text>
//           <TextInput
//             value={ourSong}
//             onChangeText={setOurSong}
//             style={styles.input}
//             placeholder="The song that reminds you of them"
//             placeholderTextColor="#9AA6B2"
//           />

//           <Text style={styles.label}>A Favorite Memory Together</Text>
//           <TextInput
//             value={favoriteMemory}
//             onChangeText={setFavoriteMemory}
//             style={[styles.input, styles.bioInput]}
//             placeholder="Describe a favorite memory..."
//             placeholderTextColor="#9AA6B2"
//             multiline
//           />
//         </View>

//         {/* Actions */}
//         <TouchableOpacity
//           style={[styles.saveButton, { backgroundColor: headerBg }]}
//           onPress={handleSave}
//           disabled={saving}
//           activeOpacity={0.9}
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
//   container: { padding: 16, paddingBottom: 40 },

//   // Hero
//   hero: {
//     borderRadius: 18,
//     padding: 16,
//     marginBottom: 14,
//     shadowColor: '#000',
//     shadowOpacity: 0.1,
//     shadowRadius: 6,
//     shadowOffset: { width: 0, height: 3 },
//     elevation: 3,
//   },
//   heroRow: { flexDirection: 'row', alignItems: 'center' },
//   avatarRing: {
//     width: 96,
//     height: 96,
//     borderRadius: 48,
//     borderWidth: 3,
//     backgroundColor: '#fff',
//     padding: 2,
//   },
//   avatarClip: {
//     width: '100%',
//     height: '100%',
//     borderRadius: 46,
//     overflow: 'hidden',
//     position: 'relative',
//   },
//   avatarImage: {
//     width: '100%',
//     height: '100%',
//     resizeMode: 'cover',
//   },
//   cameraBadge: {
//     position: 'absolute',
//     right: 4,
//     bottom: 4,
//     backgroundColor: 'rgba(0,0,0,0.6)',
//     borderRadius: 10,
//     paddingHorizontal: 6,
//     paddingVertical: 3,
//   },
//   heroName: { color: '#fff', fontSize: 22, fontWeight: '800' },
//   heroNick: { color: '#f8fafc', opacity: 0.9, marginTop: 2, fontSize: 14 },

//   // Cards
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
//   label: { marginTop: 10, marginBottom: 4, color: '#555', fontWeight: '600' },
//   input: {
//     borderWidth: 1,
//     borderColor: '#e5e7eb',
//     borderRadius: 10,
//     paddingHorizontal: 12,
//     paddingVertical: 10,
//     backgroundColor: '#fafafa',
//     fontSize: 16,
//     color: '#0f172a',
//   },
//   disabledInput: { backgroundColor: '#f0f0f0', color: '#888' },
//   bioInput: { height: 90, textAlignVertical: 'top' },

//   // Date inputs
//   dateInput: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     borderWidth: 1,
//     borderColor: '#e5e7eb',
//     borderRadius: 10,
//     paddingHorizontal: 12,
//     paddingVertical: 12,
//     backgroundColor: '#fafafa',
//   },
//   dateText: { marginLeft: 8, color: '#0f172a', fontSize: 16 },

//   // Actions
//   saveButton: {
//     padding: 15,
//     borderRadius: 12,
//     alignItems: 'center',
//     marginTop: 4,
//     elevation: 2,
//   },
//   buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
//   signOutButton: {
//     padding: 14,
//     borderRadius: 12,
//     alignItems: 'center',
//     marginTop: 12,
//     borderWidth: 1,
//     borderColor: '#FF6347',
//   },
//   signOutText: { color: '#FF6347', fontWeight: 'bold', fontSize: 16 },
// });

// export default ProfileScreen;
