// PhotoVaultScreen.js - Vault with gallery-like UI, NO share/favorites/reactions,
// move-to-gallery + delete, slideshow, no notifications
// Flicker-free viewer: frozen sources + black backdrop + absolute header/footer + no state on swipe.
// Slideshow uses a ref to track current index and updates viewerStartIndex on ticks.

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  ScrollView,
  Platform,
  Image,
  Alert,
  Dimensions,
  RefreshControl,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import ImageViewing from 'react-native-image-viewing';
import Modal from 'react-native-modal';
import BlobUtil from 'react-native-blob-util';

import { useTheme } from '../theme/ThemeContext';
import { supabase } from '../services/supabase';
import { launchImageLibrary } from 'react-native-image-picker';
import PhotoGridItem from '../components/PhotoGridItem';
import ErrorModal from '../components/ErrorModal';
import { format, parseISO, isToday } from 'date-fns';

const log = (...a) => console.log('[Vault]', ...a);

const { width } = Dimensions.get('window');
const VAULT_PASSWORD = 'LOVE';
const IMAGEKIT_PUBLIC_KEY = 'public_IAZdw7PGwJlYkHZC8/KN4/9TdRw=';

const PhotoVaultScreen = ({ navigation }) => {
  const { theme } = useTheme();

  // Animations (match Gallery vibe)
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 5,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, scaleAnim]);

  // Auth
  const [userId, setUserId] = useState('');
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id || '');
      log('userId:', user?.id);
    });
  }, []);

  // Unlock
  const [password, setPassword] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [wrongAttempt, setWrongAttempt] = useState(false);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Data
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);

  // Uploading
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  // Search
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Viewer (flicker-free: do not update index on swipe; use startIndex and a ref)
  const [isViewerVisible, setIsViewerVisible] = useState(false);
  const [viewerStartIndex, setViewerStartIndex] = useState(0); // initial index for ImageViewing
  const currentIndexRef = useRef(0); // track index internally without setState
  const [showPhotoInfo, setShowPhotoInfo] = useState(false);

  // Freeze viewer sources to prevent flicker mid-swipe
  const [viewerFrozenSources, setViewerFrozenSources] = useState([]);
  const viewerOpenRef = useRef(false);
  useEffect(() => {
    viewerOpenRef.current = isViewerVisible;
  }, [isViewerVisible]);

  // Slideshow
  const [slideshowActive, setSlideshowActive] = useState(false);
  const [slideshowDuration, setSlideshowDuration] = useState(5000);
  const [secondsModalVisible, setSecondsModalVisible] = useState(false);
  const [secondsDraft, setSecondsDraft] = useState(5);
  const slideshowTimer = useRef(null);
  const pausedByUserSwipeRef = useRef(false);
  const swipeResumeTimeoutRef = useRef(null);

  // Modals
  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);

  // Status modals
  const [errorModal, setErrorModal] = useState({ visible: false, message: '' });
  const [successModal, setSuccessModal] = useState({
    visible: false,
    message: '',
  });

  // Multi-select (batch move/delete)
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);

  // Render summary
  log('Render', {
    unlocked,
    loading,
    count: images.length,
    uploading,
    progress,
    isViewerVisible,
    slideshowActive,
    slideshowDuration,
    multiSelect,
    selectedIdsLen: selectedIds.length,
  });

  // Pulse animation for lock icon
  useEffect(() => {
    if (!unlocked) {
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
    }
  }, [unlocked, pulseAnim]);

  // Shake animation for wrong password
  const shake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, {
        toValue: 10,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: -10,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: 10,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: 0,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();
  };

  // Fetch vault images
  const fetchImages = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('images')
        .select('*')
        .eq('private', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setImages(data || []);
      log('Loaded images:', data?.length);
    } catch (e) {
      setErrorModal({ visible: true, message: e.message || String(e) });
      log('Fetch error:', e);
      setImages([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (unlocked) fetchImages();
  }, [unlocked, fetchImages]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchImages();
  };

  // Search + group by date
  const filteredImages = useMemo(() => {
    const q = (search || '').toLowerCase().trim();
    if (!q) return images;
    return images.filter(
      img =>
        img.file_name?.toLowerCase().includes(q) ||
        img.image_url?.toLowerCase().includes(q),
    );
  }, [images, search]);

  const groupedImages = useMemo(() => {
    const groups = {};
    for (const img of filteredImages) {
      try {
        const date = format(parseISO(img.created_at), 'yyyy-MM-dd');
        if (!groups[date]) groups[date] = [];
        groups[date].push(img);
      } catch {
        // ignore invalid dates
      }
    }
    return groups;
  }, [filteredImages]);

  // Viewer sources (photos only in vault)
  const viewerSources = useMemo(
    () => filteredImages.map(m => ({ uri: m.image_url })),
    [filteredImages],
  );

  // Upload to ImageKit (always private)
  const handleImagePickAndUpload = () => {
    log('Launching image library picker (vault)...');
    launchImageLibrary(
      { mediaType: 'photo', selectionLimit: 0 },
      async response => {
        log('Picker response:', {
          didCancel: response?.didCancel,
          errorCode: response?.errorCode,
          assetsLen: response?.assets?.length,
          platform: Platform.OS,
        });
        if (response?.didCancel) return;
        if (response?.errorCode) {
          setErrorModal({
            visible: true,
            message: response?.errorMessage || 'Picker error',
          });
          return;
        }
        const assets = response?.assets || [];
        if (!assets.length) return;

        try {
          setUploading(true);
          let successCount = 0;

          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (!user) {
            setErrorModal({
              visible: true,
              message: 'You are not logged in. Please log in again.',
            });
            setUploading(false);
            return;
          }

          for (let i = 0; i < assets.length; i++) {
            const asset = assets[i];
            log(`[${i + 1}/${assets.length}] Vault uploading:`, {
              fileName: asset.fileName,
              type: asset.type,
              uri: asset.uri,
            });
            setProgress(0);

            try {
              // Get ImageKit signature
              const sig = await fetch(
                'https://boyfriend-needs-backend.vercel.app/api/imagekit-auth',
              ).then(r => r.json());
              log('Got ImageKit signature');

              const fileName =
                asset.fileName ||
                `vault_${Date.now()}_${i}.${
                  (asset.type || 'image/jpeg').split('/').pop() || 'jpg'
                }`;
              const wrappedPath = BlobUtil.wrap(
                (asset.uri || '').replace('file://', ''),
              );

              const uploadData = [
                { name: 'file', filename: fileName, data: wrappedPath },
                { name: 'publicKey', data: IMAGEKIT_PUBLIC_KEY },
                { name: 'signature', data: sig.signature },
                { name: 'expire', data: String(sig.expire) },
                { name: 'token', data: sig.token },
                { name: 'fileName', data: fileName },
              ];

              const task = BlobUtil.fetch(
                'POST',
                'https://upload.imagekit.io/api/v1/files/upload',
                {},
                uploadData,
              );
              task.uploadProgress((written, total) => {
                const pct = total > 0 ? Math.round((written / total) * 100) : 0;
                setProgress(pct);
              });

              const uploadResult = await task;
              const json = uploadResult.json();
              const status = uploadResult.info().status;
              if (status >= 300)
                throw new Error(json?.message || 'ImageKit upload failed');
              const uploadUrl = json.url;
              log('Vault ImageKit upload success:', uploadUrl);

              // Insert private image (NO notifications)
              const { error: sErr } = await supabase.from('images').insert({
                user_id: user.id,
                image_url: uploadUrl,
                storage_type: 'imagekit',
                created_at: new Date().toISOString(),
                file_name: fileName,
                favorite: false,
                type: 'photo',
                private: true,
              });
              if (sErr) throw sErr;

              successCount++;
            } catch (e) {
              log('Vault upload error:', e);
              setErrorModal({ visible: true, message: e.message || String(e) });
              break;
            }
          }

          if (successCount > 0) {
            setSuccessModal({
              visible: true,
              message: `${successCount} photo(s) uploaded to vault!`,
            });
            fetchImages();
          } else {
            log('No successful uploads to vault.');
          }
        } catch (e) {
          log('Vault upload exception:', e);
          setErrorModal({ visible: true, message: e.message || String(e) });
        } finally {
          setUploading(false);
          setProgress(0);
          log('Vault upload flow finished. uploading=false');
        }
      },
    );
  };

  // Move to gallery
  const moveToGallery = async image => {
    try {
      const { error } = await supabase
        .from('images')
        .update({ private: false })
        .eq('id', image.id);
      if (error) {
        setErrorModal({ visible: true, message: error.message });
        log('Move to gallery error:', error);
      } else {
        setSuccessModal({ visible: true, message: 'Moved to Gallery!' });
        fetchImages();
      }
    } catch (e) {
      log('Move to gallery exception:', e);
      setErrorModal({ visible: true, message: e.message || String(e) });
    }
  };

  // Delete single via modal
  const confirmDeleteSingle = image => {
    setSelectedImage(image);
    setIsDeleteModalVisible(true);
    log('Open delete modal for id:', image.id);
  };

  const handleDelete = async () => {
    if (!selectedImage) return;
    try {
      const { error } = await supabase
        .from('images')
        .delete()
        .eq('id', selectedImage.id);
      if (error) {
        setErrorModal({ visible: true, message: error.message });
        log('Delete error:', error);
      } else {
        setIsDeleteModalVisible(false);
        setSelectedImage(null);
        fetchImages();
        log('Deleted image id:', selectedImage.id);
      }
    } catch (e) {
      log('Delete exception:', e);
      setErrorModal({ visible: true, message: e.message || String(e) });
    }
  };

  // Multi-select helpers
  const toggleSelect = id => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id],
    );
    log('Toggle select id:', id);
  };
  const startMultiSelect = id => {
    if (!multiSelect) setMultiSelect(true);
    toggleSelect(id);
    log('Start multi-select with id:', id);
  };
  const handleSelectAll = () => {
    const ids = filteredImages.map(i => i.id);
    setSelectedIds(ids);
    setMultiSelect(true);
    log('Selected all:', ids.length);
  };
  const handleBatchDelete = async () => {
    if (!selectedIds.length) return;
    Alert.alert('Delete', `Delete ${selectedIds.length} item(s)?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await supabase.from('images').delete().in('id', selectedIds);
            setSelectedIds([]);
            setMultiSelect(false);
            fetchImages();
            log('Batch deleted count:', selectedIds.length);
          } catch (e) {
            log('Batch delete error:', e);
            setErrorModal({ visible: true, message: e.message || String(e) });
          }
        },
      },
    ]);
  };
  const handleBatchMove = async () => {
    if (!selectedIds.length) return;
    Alert.alert(
      'Move to Gallery',
      `Move ${selectedIds.length} item(s) to Gallery?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Move',
          onPress: async () => {
            try {
              await supabase
                .from('images')
                .update({ private: false })
                .in('id', selectedIds);
              setSelectedIds([]);
              setMultiSelect(false);
              fetchImages();
              setSuccessModal({ visible: true, message: 'Moved to Gallery!' });
              log('Batch moved to gallery count:', selectedIds.length);
            } catch (e) {
              log('Batch move error:', e);
              setErrorModal({ visible: true, message: e.message || String(e) });
            }
          },
        },
      ],
    );
  };

  // Open item (flicker-free: freeze sources and set start index)
  const openItem = item => {
    if (multiSelect) {
      toggleSelect(item.id);
      return;
    }
    const idx = filteredImages.findIndex(p => p.id === item.id);
    setViewerStartIndex(Math.max(0, idx));
    currentIndexRef.current = Math.max(0, idx);
    setIsViewerVisible(true);
    setShowPhotoInfo(false);
    setViewerFrozenSources(viewerSources); // freeze to avoid flicker
    log('Open viewer for id:', item.id, 'index:', idx);
  };

  // Slideshow controls: use ref index, update startIndex on tick (no state on swipe)
  const startSlideshowTimer = (reason = 'start') => {
    if (slideshowTimer.current) clearInterval(slideshowTimer.current);
    if (!filteredImages.length) return;

    slideshowTimer.current = setInterval(() => {
      const next = (currentIndexRef.current + 1) % filteredImages.length;
      currentIndexRef.current = next;
      setViewerStartIndex(next); // updates viewer image programmatically (rare update -> minimal flicker)
      log('[Slideshow]', reason, 'tick -> next index:', next);
    }, slideshowDuration);
    log(
      '[Slideshow] (re)started every',
      slideshowDuration,
      'ms reason:',
      reason,
    );
  };
  const stopSlideshowTimer = (reason = 'stop') => {
    if (slideshowTimer.current) {
      clearInterval(slideshowTimer.current);
      slideshowTimer.current = null;
      log('[Slideshow] Stopped. reason:', reason);
    }
  };
  const promptSlideshowSeconds = () => {
    setSecondsDraft(
      Math.max(1, Math.min(30, Math.round(slideshowDuration / 1000))),
    );
    setSecondsModalVisible(true);
    log('[Slideshow] Seconds picker opened');
  };
  const confirmSlideshowSeconds = () => {
    const ms = Math.max(1, Math.min(30, secondsDraft)) * 1000;
    setSecondsModalVisible(false);
    setSlideshowDuration(ms);
    setSlideshowActive(true);
    startSlideshowTimer('confirm-seconds');
    log('[Slideshow] Started with:', ms, 'ms');
  };
  const toggleSlideshow = () => {
    if (slideshowActive) {
      stopSlideshowTimer('toggle-off');
      setSlideshowActive(false);
      log('Slideshow stopped');
    } else {
      promptSlideshowSeconds();
    }
  };
  useEffect(() => {
    if (slideshowActive) {
      startSlideshowTimer('duration-change');
      log('Slideshow duration updated:', slideshowDuration);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideshowDuration, slideshowActive, filteredImages.length]);
  useEffect(() => {
    return () => {
      stopSlideshowTimer('unmount');
      if (swipeResumeTimeoutRef.current)
        clearTimeout(swipeResumeTimeoutRef.current);
    };
  }, []);

  // Section renderer (gallery-style)
  const renderSection = (date, imagesArr) => (
    <Animated.View
      key={date}
      style={[
        styles.section,
        { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
      ]}
    >
      <LinearGradient
        colors={[theme.colors.ultraLight, 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.sectionHeaderGradient}
      >
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>
            {isToday(parseISO(date))
              ? '✨ Today'
              : format(parseISO(date), 'MMMM d, yyyy')}
          </Text>
        </View>
      </LinearGradient>
      <FlatList
        data={imagesArr}
        numColumns={2}
        keyExtractor={item => item.id.toString()}
        renderItem={({ item }) => (
          <PhotoGridItem
            image={item}
            onPress={() => openItem(item)}
            onLongPress={() => startMultiSelect(item.id)}
            selected={selectedIds.includes(item.id)}
            showSelect={multiSelect}
          />
        )}
        scrollEnabled={false}
      />
    </Animated.View>
  );

  // Handle unlock
  const handleUnlock = () => {
    if ((password || '').toUpperCase() === VAULT_PASSWORD) {
      setUnlocked(true);
      setPassword('');
      log('Vault unlocked');
    } else {
      setWrongAttempt(true);
      shake();
      setTimeout(() => setWrongAttempt(false), 2000);
      setPassword('');
      log('Vault unlock failed');
    }
  };

  // Password screen - Enhanced Design
  if (!unlocked) {
    return (
      <LinearGradient
        colors={[theme.colors.primary, theme.colors.secondary]}
        style={styles.lockScreenGradient}
      >
        <SafeAreaView style={styles.lockScreen}>
          {/* Back Button */}
          <TouchableOpacity
            style={styles.lockBackButton}
            onPress={() => navigation.goBack()}
          >
            <Icon name="arrow-back" size={28} color="#FFFFFF" />
          </TouchableOpacity>

          {/* Lock Icon Container */}
          <Animated.View
            style={[
              styles.lockIconContainer,
              { transform: [{ scale: pulseAnim }] },
            ]}
          >
            <LinearGradient
              colors={['rgba(255,255,255,0.2)', 'rgba(255,255,255,0.05)']}
              style={styles.lockIconGradient}
            >
              <Icon name="lock-closed" size={50} color="#FFFFFF" />
            </LinearGradient>
          </Animated.View>

          {/* Title */}
          <Text style={styles.lockTitle}>Private Vault</Text>
          <Text style={styles.lockSubtitle}>Enter your secret password</Text>

          {/* Password Input Container */}
          <Animated.View
            style={[
              styles.passwordContainer,
              { transform: [{ translateX: shakeAnim }] },
            ]}
          >
            <View
              style={[
                styles.passwordInputWrapper,
                wrongAttempt && styles.passwordInputError,
              ]}
            >
              <Icon
                name="key"
                size={20}
                color={wrongAttempt ? '#FF6B6B' : 'rgba(255,255,255,0.7)'}
              />
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Enter password"
                placeholderTextColor="rgba(255,255,255,0.4)"
                style={styles.passwordInput}
                secureTextEntry={!showPassword}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={10}
                onSubmitEditing={handleUnlock}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeButton}
              >
                <Icon
                  name={showPassword ? 'eye-off' : 'eye'}
                  size={20}
                  color="rgba(255,255,255,0.7)"
                />
              </TouchableOpacity>
            </View>
          </Animated.View>

          {/* Error Message */}
          {wrongAttempt && (
            <Animated.View style={styles.errorContainer}>
              <Text style={styles.errorText}>
                ❌ Wrong password, try again!
              </Text>
            </Animated.View>
          )}

          {/* Unlock Button */}
          <TouchableOpacity
            style={styles.unlockBtn}
            onPress={handleUnlock}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={['#FFFFFF', '#F0F0F0']}
              style={styles.unlockBtnGradient}
            >
              <Text
                style={[styles.unlockText, { color: theme.colors.primary }]}
              >
                Unlock Vault
              </Text>
              <Icon name="lock-open" size={20} color={theme.colors.primary} />
            </LinearGradient>
          </TouchableOpacity>

          {/* Hint */}
          <View style={styles.hintContainer}>
            <Icon
              name="information-circle-outline"
              size={16}
              color="rgba(255,255,255,0.5)"
            />
            <Text style={styles.hintText}>
              Password hint: It's what we share 💕
            </Text>
          </View>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  // Loading
  if (loading) {
    return (
      <LinearGradient colors={theme.gradient} style={styles.loader}>
        <ActivityIndicator size="large" color="#FFFFFF" />
        <Text style={styles.loadingText}>Opening your vault...</Text>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient
      colors={[theme.colors.ultraLight, '#FFFFFF', theme.colors.light]}
      style={styles.container}
    >
      <SafeAreaView style={{ flex: 1 }}>
        {/* Header */}
        <Animated.View
          style={[
            styles.header,
            {
              opacity: fadeAnim,
              transform: [
                {
                  translateY: fadeAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-20, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Icon name="arrow-back" size={24} color={theme.colors.primary} />
          </TouchableOpacity>

          <LinearGradient
            colors={theme.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.headerTitleContainer}
          >
            <Text style={styles.headerTitle}>Photo Vault 🔐</Text>
          </LinearGradient>

          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setMultiSelect(v => !v)}
          >
            <Icon
              name={multiSelect ? 'checkbox' : 'checkbox-outline'}
              size={24}
              color={theme.colors.primary}
            />
          </TouchableOpacity>
        </Animated.View>

        {/* Multi-select bar */}
        {multiSelect && (
          <Animated.View
            style={[
              styles.multiSelectBar,
              {
                opacity: fadeAnim,
                transform: [
                  {
                    translateY: fadeAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-20, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <LinearGradient
              colors={[
                theme.colors.primary + '20',
                theme.colors.secondary + '10',
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.multiSelectGradient}
            >
              <Text
                style={[styles.selectedText, { color: theme.colors.primary }]}
              >
                {selectedIds.length} selected
              </Text>
              <View style={styles.multiSelectActions}>
                <TouchableOpacity
                  onPress={handleBatchMove}
                  style={styles.multiSelectButton}
                >
                  <Icon name="images" size={22} color={theme.colors.accent} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleBatchDelete}
                  style={styles.multiSelectButton}
                >
                  <Icon name="trash" size={22} color={theme.shared.red} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSelectAll}
                  style={styles.multiSelectButton}
                >
                  <Icon
                    name="checkmark-done"
                    size={22}
                    color={theme.shared.green}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setMultiSelect(false);
                    setSelectedIds([]);
                  }}
                  style={styles.multiSelectButton}
                >
                  <Icon name="close-circle" size={22} color={theme.gray.dark} />
                </TouchableOpacity>
              </View>
            </LinearGradient>
          </Animated.View>
        )}

        {/* Search bar */}
        <Animated.View
          style={[
            styles.searchBar,
            { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
          ]}
        >
          <LinearGradient
            colors={['#FFFFFF', theme.colors.ultraLight]}
            style={styles.searchGradient}
          >
            <Icon name="search" size={20} color={theme.colors.primary} />
            <TextInput
              style={[
                styles.searchInput,
                { color: theme.colors.primary, fontWeight: '500' },
              ]}
              placeholder="Search in vault..."
              placeholderTextColor={theme.colors.primary + '60'}
              value={search}
              onChangeText={t => {
                setSearch(t);
                log('Search changed:', t);
              }}
              selectionColor={theme.colors.primary}
            />
          </LinearGradient>
        </Animated.View>

        {/* Empty State */}
        {filteredImages.length === 0 && !loading && (
          <View style={styles.emptyState}>
            <Icon
              name="lock-closed-outline"
              size={80}
              color={theme.colors.primary + '40'}
            />
            <Text style={[styles.emptyTitle, { color: theme.colors.primary }]}>
              Your vault is empty
            </Text>
            <Text
              style={[
                styles.emptySubtitle,
                { color: theme.colors.primary + '80' },
              ]}
            >
              Tap the upload button to add private photos
            </Text>
          </View>
        )}

        {/* Sections */}
        <ScrollView
          contentContainerStyle={{ paddingBottom: 120 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.primary}
              colors={[theme.colors.primary]}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          {Object.keys(groupedImages).map(date =>
            renderSection(date, groupedImages[date]),
          )}
        </ScrollView>

        {/* Upload FAB */}
        <TouchableOpacity
          style={styles.fab}
          onPress={handleImagePickAndUpload}
          activeOpacity={0.8}
        >
          <LinearGradient colors={theme.gradient} style={styles.fabGradient}>
            <Icon name="cloud-upload" size={28} color="#FFFFFF" />
          </LinearGradient>
        </TouchableOpacity>

        {/* Upload Progress */}
        {uploading && (
          <Animated.View style={[styles.uploadStatus, { opacity: fadeAnim }]}>
            <LinearGradient
              colors={[
                theme.colors.primary + 'DD',
                theme.colors.secondary + 'DD',
              ]}
              style={styles.uploadGradient}
            >
              <ActivityIndicator color="white" />
              <Text style={styles.uploadText}>Uploading... {progress}%</Text>
            </LinearGradient>
          </Animated.View>
        )}

        {/* Black backdrop under viewer to prevent flashes */}
        {isViewerVisible && (
          <View pointerEvents="none" style={styles.viewerBackdrop} />
        )}

        {/* Viewer */}
        <ImageViewing
          images={
            viewerFrozenSources.length ? viewerFrozenSources : viewerSources
          }
          imageIndex={viewerStartIndex}
          visible={isViewerVisible}
          onRequestClose={() => {
            setIsViewerVisible(false);
            setViewerFrozenSources([]);
            if (slideshowActive) {
              stopSlideshowTimer('viewer-close');
              setSlideshowActive(false);
            }
            fetchImages(); // catch up if anything changed
          }}
          backgroundColor="#000"
          animationType="none"
          doubleTapToZoomEnabled
          swipeToCloseEnabled
          imageContainerStyle={{ backgroundColor: '#000' }}
          onImageIndexChange={idx => {
            currentIndexRef.current = idx; // track without setState (no flicker)
            // Smooth swipe: pause slideshow and resume shortly after
            if (slideshowActive) {
              pausedByUserSwipeRef.current = true;
              stopSlideshowTimer('user-swipe');
              setSlideshowActive(false);
              if (swipeResumeTimeoutRef.current)
                clearTimeout(swipeResumeTimeoutRef.current);
              swipeResumeTimeoutRef.current = setTimeout(() => {
                if (pausedByUserSwipeRef.current) {
                  pausedByUserSwipeRef.current = false;
                  setSlideshowActive(true);
                  startSlideshowTimer('resume-after-swipe');
                }
              }, 600);
            }
          }}
          HeaderComponent={({ imageIndex, onRequestClose }) => (
            <LinearGradient
              colors={['rgba(0,0,0,0.7)', 'transparent']}
              style={styles.viewerHeader}
            >
              <TouchableOpacity
                onPress={() => {
                  // Close directly; onRequestClose is not provided by the library to HeaderComponent
                  setIsViewerVisible(false);
                  setViewerFrozenSources([]);
                  if (slideshowActive) {
                    stopSlideshowTimer('viewer-close');
                    setSlideshowActive(false);
                  }
                  fetchImages();
                }}
                style={styles.viewerCloseButton}
              >
                <Icon name="close" size={28} color="#FFFFFF" />
              </TouchableOpacity>
              <View style={styles.viewerHeaderActions}>
                <TouchableOpacity
                  onPress={toggleSlideshow}
                  style={styles.viewerHeaderButton}
                >
                  <Icon
                    name={slideshowActive ? 'pause' : 'play'}
                    size={24}
                    color="#FFFFFF"
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setShowPhotoInfo(v => !v)}
                  style={styles.viewerHeaderButton}
                >
                  <Icon name="information-circle" size={24} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            </LinearGradient>
          )}
          FooterComponent={({ imageIndex }) => {
            const item = filteredImages[imageIndex];
            if (!item) return null;
            return (
              <>
                <LinearGradient
                  colors={['transparent', 'rgba(0,0,0,0.8)']}
                  style={styles.viewerFooter}
                >
                  {/* Move to gallery */}
                  <TouchableOpacity
                    style={styles.viewerButton}
                    onPress={() => {
                      setIsViewerVisible(false);
                      setViewerFrozenSources([]);
                      moveToGallery(item);
                    }}
                  >
                    <Icon name="images" size={24} color="#4FC3F7" />
                    <Text style={styles.viewerButtonText}>Gallery</Text>
                  </TouchableOpacity>
                  {/* Delete */}
                  <TouchableOpacity
                    style={styles.viewerButton}
                    onPress={() => {
                      setIsViewerVisible(false);
                      setViewerFrozenSources([]);
                      confirmDeleteSingle(item);
                    }}
                  >
                    <Icon name="trash" size={24} color={theme.shared.red} />
                    <Text style={styles.viewerButtonText}>Delete</Text>
                  </TouchableOpacity>
                </LinearGradient>

                {/* Photo Info Overlay */}
                {showPhotoInfo && (
                  <Animated.View style={styles.photoInfoOverlay}>
                    <LinearGradient
                      colors={['rgba(0,0,0,0.9)', 'rgba(0,0,0,0.7)']}
                      style={styles.photoInfoContainer}
                    >
                      <Text style={styles.photoInfoTitle}>Photo Details</Text>
                      <View style={styles.photoInfoRow}>
                        <Icon
                          name="document-text"
                          size={16}
                          color="#FFFFFF80"
                        />
                        <Text style={styles.photoInfoText}>
                          {item.file_name || 'Untitled'}
                        </Text>
                      </View>
                      <View style={styles.photoInfoRow}>
                        <Icon name="calendar" size={16} color="#FFFFFF80" />
                        <Text style={styles.photoInfoText}>
                          {format(parseISO(item.created_at), 'PPpp')}
                        </Text>
                      </View>
                      <View style={styles.photoInfoRow}>
                        <Icon name="lock-closed" size={16} color="#FFFFFF80" />
                        <Text style={styles.photoInfoText}>Private</Text>
                      </View>
                    </LinearGradient>
                  </Animated.View>
                )}
              </>
            );
          }}
        />

        {/* Seconds modal */}
        <Modal
          isVisible={secondsModalVisible}
          onBackdropPress={() => setSecondsModalVisible(false)}
          onBackButtonPress={() => setSecondsModalVisible(false)}
          backdropOpacity={0.5}
          useNativeDriver
        >
          <View style={styles.secondsModal}>
            <Text style={styles.secondsTitle}>Slideshow Interval</Text>

            <View style={styles.secondsChips}>
              {[3, 5, 10, 15].map(s => (
                <TouchableOpacity
                  key={s}
                  style={[
                    styles.secondsChip,
                    secondsDraft === s && styles.secondsChipActive,
                  ]}
                  onPress={() => setSecondsDraft(s)}
                >
                  <Text
                    style={[
                      styles.secondsChipText,
                      secondsDraft === s && styles.secondsChipTextActive,
                    ]}
                  >
                    {s} sec
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.secondsRow}>
              <TouchableOpacity
                onPress={() => setSecondsDraft(v => Math.max(1, v - 1))}
                style={styles.secondsBtn}
              >
                <Icon name="remove" size={22} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.secondsValue}>{secondsDraft}s</Text>
              <TouchableOpacity
                onPress={() => setSecondsDraft(v => Math.min(30, v + 1))}
                style={styles.secondsBtn}
              >
                <Icon name="add" size={22} color="#fff" />
              </TouchableOpacity>
            </View>

            <View style={styles.secondsActions}>
              <TouchableOpacity
                onPress={() => setSecondsModalVisible(false)}
                style={[styles.secondsActionBtn, { backgroundColor: '#555' }]}
              >
                <Text style={styles.secondsActionText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={confirmSlideshowSeconds}
                style={[
                  styles.secondsActionBtn,
                  { backgroundColor: theme.colors.primary },
                ]}
              >
                <Text style={styles.secondsActionText}>Start</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Delete Modal */}
        <Modal isVisible={isDeleteModalVisible}>
          <View style={styles.modalContent}>
            <Icon name="trash-outline" size={50} color={theme.shared.red} />
            <Text style={styles.modalTitle}>Delete Photo</Text>
            <Text style={styles.modalMessage}>
              Are you sure you want to delete this photo from your vault? This
              action cannot be undone.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={() => setIsDeleteModalVisible(false)}
              >
                <Text style={styles.modalButtonCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonDelete]}
                onPress={handleDelete}
              >
                <Text style={styles.modalButtonText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Error & Success */}
        <ErrorModal
          visible={errorModal.visible}
          message={errorModal.message}
          onClose={() => setErrorModal({ visible: false, message: '' })}
          theme={theme}
        />
        <ErrorModal
          visible={successModal.visible}
          message={successModal.message}
          onClose={() => setSuccessModal({ visible: false, message: '' })}
          theme={theme}
        />
      </SafeAreaView>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: {
    color: '#FFFFFF',
    fontSize: 18,
    marginTop: 16,
    fontWeight: '600',
  },

  // Enhanced Lock Screen Styles
  lockScreenGradient: { flex: 1 },
  lockScreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  lockBackButton: {
    position: 'absolute',
    top: 50,
    left: 20,
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 25,
  },
  lockIconContainer: { marginBottom: 30 },
  lockIconGradient: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  lockTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 8,
    letterSpacing: 1,
  },
  lockSubtitle: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.8)',
    marginBottom: 40,
  },
  passwordContainer: { width: '100%', marginBottom: 20 },
  passwordInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 4,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  passwordInputError: {
    borderColor: '#FF6B6B',
    backgroundColor: 'rgba(255,107,107,0.1)',
  },
  passwordInput: {
    flex: 1,
    fontSize: 18,
    color: '#FFFFFF',
    paddingVertical: 16,
    paddingHorizontal: 12,
    fontWeight: '500',
    letterSpacing: 4,
  },
  eyeButton: { padding: 8 },
  errorContainer: {
    backgroundColor: 'rgba(255,107,107,0.2)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 20,
  },
  errorText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  unlockBtn: { width: '100%', marginTop: 10 },
  unlockBtnGradient: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
    borderRadius: 16,
    elevation: 5,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  unlockText: { fontSize: 18, fontWeight: 'bold', marginRight: 8 },
  hintContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 30,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 20,
  },
  hintText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    marginLeft: 6,
    fontStyle: 'italic',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    justifyContent: 'space-between',
  },
  headerTitleContainer: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginHorizontal: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'center',
  },

  // Search
  searchBar: { marginHorizontal: 16, marginBottom: 12 },
  searchGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 25,
    paddingHorizontal: 16,
    paddingVertical: 12,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  searchInput: { flex: 1, marginLeft: 12, fontSize: 16 },

  // Empty State
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginTop: 20,
    marginBottom: 8,
  },
  emptySubtitle: { fontSize: 16, textAlign: 'center' },

  // Sections
  section: { marginBottom: 24, marginHorizontal: 16 },
  sectionHeaderGradient: { borderRadius: 12, marginBottom: 12 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  sectionTitle: { fontSize: 18, fontWeight: 'bold' },

  // FAB
  fab: { position: 'absolute', right: 24, bottom: 100, zIndex: 10 },
  fabGradient: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },

  // Upload status
  uploadStatus: {
    position: 'absolute',
    bottom: 140,
    alignSelf: 'center',
    zIndex: 10,
  },
  uploadGradient: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 25,
    flexDirection: 'row',
    alignItems: 'center',
  },
  uploadText: {
    marginLeft: 12,
    fontSize: 16,
    color: 'white',
    fontWeight: '600',
  },

  // Multi-select bar
  multiSelectBar: { marginHorizontal: 16, marginBottom: 12 },
  multiSelectGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    padding: 12,
    justifyContent: 'space-between',
    elevation: 2,
  },
  selectedText: { fontWeight: 'bold', fontSize: 16 },
  multiSelectActions: { flexDirection: 'row', alignItems: 'center' },
  multiSelectButton: {
    padding: 8,
    marginHorizontal: 4,
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderRadius: 20,
  },

  // Backdrop for viewer
  viewerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    zIndex: 999,
  },

  // Viewer
  viewerHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 20,
    zIndex: 10,
  },
  viewerCloseButton: { padding: 8 },
  viewerHeaderActions: { flexDirection: 'row', alignItems: 'center' },
  viewerHeaderButton: { padding: 8, marginLeft: 16 },
  viewerFooter: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 16,
    position: 'absolute',
    bottom: 0,
    width: '100%',
  },
  viewerButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 25,
    marginHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  viewerButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    marginLeft: 6,
    fontWeight: '600',
  },

  // Photo Info Overlay
  photoInfoOverlay: { position: 'absolute', bottom: 100, left: 20, right: 20 },
  photoInfoContainer: { borderRadius: 16, padding: 16 },
  photoInfoTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  photoInfoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  photoInfoText: { color: '#FFFFFF', fontSize: 14, marginLeft: 8 },

  // Seconds modal
  secondsModal: {
    backgroundColor: '#222',
    padding: 24,
    borderRadius: 20,
    alignItems: 'center',
  },
  secondsTitle: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 18,
    marginBottom: 20,
    textAlign: 'center',
  },
  secondsChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginBottom: 20,
  },
  secondsChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#333',
    margin: 6,
  },
  secondsChipActive: {
    backgroundColor: '#555',
    borderWidth: 1,
    borderColor: '#888',
  },
  secondsChipText: { color: '#eee', fontSize: 14, fontWeight: '600' },
  secondsChipTextActive: { color: '#fff' },
  secondsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  secondsBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#444',
  },
  secondsValue: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 24,
    marginHorizontal: 24,
    minWidth: 50,
    textAlign: 'center',
  },
  secondsActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  secondsActionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    marginHorizontal: 8,
    alignItems: 'center',
  },
  secondsActionText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  // Delete modal - Enhanced
  modalContent: {
    backgroundColor: '#fff',
    padding: 28,
    borderRadius: 20,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 16,
    marginBottom: 12,
  },
  modalMessage: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  modalActions: { flexDirection: 'row', width: '100%' },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    marginHorizontal: 8,
    alignItems: 'center',
  },
  modalButtonCancel: { backgroundColor: '#E0E0E0' },
  modalButtonCancelText: { color: '#666', fontWeight: '600', fontSize: 16 },
  modalButtonDelete: { backgroundColor: '#FF5252' },
  modalButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});

export default PhotoVaultScreen;

// // PhotoVaultScreen.js - Vault with gallery-like UI, NO share/favorites/reactions, move-to-gallery + delete, slideshow, no notifications
// import React, {
//   useState,
//   useEffect,
//   useCallback,
//   useMemo,
//   useRef,
// } from 'react';
// import {
//   View,
//   Text,
//   StyleSheet,
//   FlatList,
//   TouchableOpacity,
//   ActivityIndicator,
//   TextInput,
//   ScrollView,
//   Platform,
//   Image,
//   Alert,
//   Dimensions,
//   RefreshControl,
//   Animated,
// } from 'react-native';
// import { SafeAreaView } from 'react-native-safe-area-context';
// import LinearGradient from 'react-native-linear-gradient';
// import Icon from 'react-native-vector-icons/Ionicons';
// import ImageViewing from 'react-native-image-viewing';
// import Modal from 'react-native-modal';
// import BlobUtil from 'react-native-blob-util';

// import { useTheme } from '../theme/ThemeContext';
// import { supabase } from '../services/supabase';
// import { launchImageLibrary } from 'react-native-image-picker';
// import PhotoGridItem from '../components/PhotoGridItem';
// import ErrorModal from '../components/ErrorModal';
// import { format, parseISO, isToday } from 'date-fns';

// const log = (...a) => console.log('[Vault]', ...a);

// const { width } = Dimensions.get('window');
// const VAULT_PASSWORD = 'LOVE';
// const IMAGEKIT_PUBLIC_KEY = 'public_IAZdw7PGwJlYkHZC8/KN4/9TdRw=';

// const PhotoVaultScreen = ({ navigation }) => {
//   const { theme } = useTheme();

//   // Animations (match Gallery vibe)
//   const fadeAnim = useRef(new Animated.Value(0)).current;
//   const scaleAnim = useRef(new Animated.Value(0.9)).current;
//   useEffect(() => {
//     Animated.parallel([
//       Animated.timing(fadeAnim, {
//         toValue: 1,
//         duration: 800,
//         useNativeDriver: true,
//       }),
//       Animated.spring(scaleAnim, {
//         toValue: 1,
//         friction: 5,
//         useNativeDriver: true,
//       }),
//     ]).start();
//   }, [fadeAnim, scaleAnim]);

//   // Auth
//   const [userId, setUserId] = useState('');
//   useEffect(() => {
//     supabase.auth.getUser().then(({ data: { user } }) => {
//       setUserId(user?.id || '');
//       log('userId:', user?.id);
//     });
//   }, []);

//   // Unlock
//   const [password, setPassword] = useState('');
//   const [unlocked, setUnlocked] = useState(false);
//   const [showPassword, setShowPassword] = useState(false);
//   const [wrongAttempt, setWrongAttempt] = useState(false);
//   const shakeAnim = useRef(new Animated.Value(0)).current;
//   const pulseAnim = useRef(new Animated.Value(1)).current;

//   // Data
//   const [images, setImages] = useState([]);
//   const [loading, setLoading] = useState(true);

//   // Uploading
//   const [uploading, setUploading] = useState(false);
//   const [progress, setProgress] = useState(0);

//   // Search
//   const [search, setSearch] = useState('');
//   const [refreshing, setRefreshing] = useState(false);

//   // Viewer
//   const [isViewerVisible, setIsViewerVisible] = useState(false);
//   const [viewerIndex, setViewerIndex] = useState(0);
//   const [showPhotoInfo, setShowPhotoInfo] = useState(false);

//   // Freeze viewer sources to prevent flicker mid-swipe
//   const [viewerFrozenSources, setViewerFrozenSources] = useState([]);
//   const viewerOpenRef = useRef(false);
//   useEffect(() => {
//     viewerOpenRef.current = isViewerVisible;
//   }, [isViewerVisible]);

//   // Slideshow
//   const [slideshowActive, setSlideshowActive] = useState(false);
//   const [slideshowDuration, setSlideshowDuration] = useState(5000);
//   const [secondsModalVisible, setSecondsModalVisible] = useState(false);
//   const [secondsDraft, setSecondsDraft] = useState(5);
//   const slideshowTimer = useRef(null);
//   const pausedByUserSwipeRef = useRef(false);
//   const swipeResumeTimeoutRef = useRef(null);

//   // Modals
//   const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
//   const [selectedImage, setSelectedImage] = useState(null);

//   // Status modals
//   const [errorModal, setErrorModal] = useState({ visible: false, message: '' });
//   const [successModal, setSuccessModal] = useState({
//     visible: false,
//     message: '',
//   });

//   // Multi-select (batch move/delete)
//   const [multiSelect, setMultiSelect] = useState(false);
//   const [selectedIds, setSelectedIds] = useState([]);

//   // Render summary
//   log('Render', {
//     unlocked,
//     loading,
//     count: images.length,
//     uploading,
//     progress,
//     isViewerVisible,
//     slideshowActive,
//     slideshowDuration,
//     multiSelect,
//     selectedIdsLen: selectedIds.length,
//   });

//   // Pulse animation for lock icon
//   useEffect(() => {
//     if (!unlocked) {
//       Animated.loop(
//         Animated.sequence([
//           Animated.timing(pulseAnim, {
//             toValue: 1.1,
//             duration: 1000,
//             useNativeDriver: true,
//           }),
//           Animated.timing(pulseAnim, {
//             toValue: 1,
//             duration: 1000,
//             useNativeDriver: true,
//           }),
//         ]),
//       ).start();
//     }
//   }, [unlocked, pulseAnim]);

//   // Shake animation for wrong password
//   const shake = () => {
//     Animated.sequence([
//       Animated.timing(shakeAnim, {
//         toValue: 10,
//         duration: 100,
//         useNativeDriver: true,
//       }),
//       Animated.timing(shakeAnim, {
//         toValue: -10,
//         duration: 100,
//         useNativeDriver: true,
//       }),
//       Animated.timing(shakeAnim, {
//         toValue: 10,
//         duration: 100,
//         useNativeDriver: true,
//       }),
//       Animated.timing(shakeAnim, {
//         toValue: 0,
//         duration: 100,
//         useNativeDriver: true,
//       }),
//     ]).start();
//   };

//   // Fetch vault images
//   const fetchImages = useCallback(async () => {
//     try {
//       setLoading(true);
//       const { data, error } = await supabase
//         .from('images')
//         .select('*')
//         .eq('private', true)
//         .order('created_at', { ascending: false });
//       if (error) throw error;
//       setImages(data || []);
//       log('Loaded images:', data?.length);
//     } catch (e) {
//       setErrorModal({ visible: true, message: e.message || String(e) });
//       log('Fetch error:', e);
//       setImages([]);
//     } finally {
//       setLoading(false);
//       setRefreshing(false);
//     }
//   }, []);

//   useEffect(() => {
//     if (unlocked) fetchImages();
//   }, [unlocked, fetchImages]);

//   const onRefresh = () => {
//     setRefreshing(true);
//     fetchImages();
//   };

//   // Search + group by date
//   const filteredImages = useMemo(() => {
//     const q = (search || '').toLowerCase().trim();
//     if (!q) return images;
//     return images.filter(
//       img =>
//         img.file_name?.toLowerCase().includes(q) ||
//         img.image_url?.toLowerCase().includes(q),
//     );
//   }, [images, search]);

//   const groupedImages = useMemo(() => {
//     const groups = {};
//     for (const img of filteredImages) {
//       try {
//         const date = format(parseISO(img.created_at), 'yyyy-MM-dd');
//         if (!groups[date]) groups[date] = [];
//         groups[date].push(img);
//       } catch {
//         // ignore invalid dates
//       }
//     }
//     return groups;
//   }, [filteredImages]);

//   // Viewer sources (photos only in vault)
//   const viewerSources = useMemo(
//     () => filteredImages.map(m => ({ uri: m.image_url })),
//     [filteredImages],
//   );

//   // Upload to ImageKit (always private)
//   const handleImagePickAndUpload = () => {
//     log('Launching image library picker (vault)...');
//     launchImageLibrary(
//       { mediaType: 'photo', selectionLimit: 0 },
//       async response => {
//         log('Picker response:', {
//           didCancel: response?.didCancel,
//           errorCode: response?.errorCode,
//           assetsLen: response?.assets?.length,
//           platform: Platform.OS,
//         });
//         if (response?.didCancel) return;
//         if (response?.errorCode) {
//           setErrorModal({
//             visible: true,
//             message: response?.errorMessage || 'Picker error',
//           });
//           return;
//         }
//         const assets = response?.assets || [];
//         if (!assets.length) return;

//         try {
//           setUploading(true);
//           let successCount = 0;

//           const {
//             data: { user },
//           } = await supabase.auth.getUser();
//           if (!user) {
//             setErrorModal({
//               visible: true,
//               message: 'You are not logged in. Please log in again.',
//             });
//             setUploading(false);
//             return;
//           }

//           for (let i = 0; i < assets.length; i++) {
//             const asset = assets[i];
//             log(`[${i + 1}/${assets.length}] Vault uploading:`, {
//               fileName: asset.fileName,
//               type: asset.type,
//               uri: asset.uri,
//             });
//             setProgress(0);

//             try {
//               // Get ImageKit signature
//               const sig = await fetch(
//                 'https://boyfriend-needs-backend.vercel.app/api/imagekit-auth',
//               ).then(r => r.json());
//               log('Got ImageKit signature');

//               const fileName =
//                 asset.fileName ||
//                 `vault_${Date.now()}_${i}.${
//                   (asset.type || 'image/jpeg').split('/').pop() || 'jpg'
//                 }`;
//               const wrappedPath = BlobUtil.wrap(
//                 (asset.uri || '').replace('file://', ''),
//               );

//               const uploadData = [
//                 { name: 'file', filename: fileName, data: wrappedPath },
//                 { name: 'publicKey', data: IMAGEKIT_PUBLIC_KEY },
//                 { name: 'signature', data: sig.signature },
//                 { name: 'expire', data: String(sig.expire) },
//                 { name: 'token', data: sig.token },
//                 { name: 'fileName', data: fileName },
//               ];

//               const task = BlobUtil.fetch(
//                 'POST',
//                 'https://upload.imagekit.io/api/v1/files/upload',
//                 {},
//                 uploadData,
//               );
//               task.uploadProgress((written, total) => {
//                 const pct = total > 0 ? Math.round((written / total) * 100) : 0;
//                 setProgress(pct);
//               });

//               const uploadResult = await task;
//               const json = uploadResult.json();
//               const status = uploadResult.info().status;
//               if (status >= 300)
//                 throw new Error(json?.message || 'ImageKit upload failed');
//               const uploadUrl = json.url;
//               log('Vault ImageKit upload success:', uploadUrl);

//               // Insert private image (NO notifications)
//               const { error: sErr } = await supabase.from('images').insert({
//                 user_id: user.id,
//                 image_url: uploadUrl,
//                 storage_type: 'imagekit',
//                 created_at: new Date().toISOString(),
//                 file_name: fileName,
//                 favorite: false,
//                 type: 'photo',
//                 private: true,
//               });
//               if (sErr) throw sErr;

//               successCount++;
//             } catch (e) {
//               log('Vault upload error:', e);
//               setErrorModal({ visible: true, message: e.message || String(e) });
//               break;
//             }
//           }

//           if (successCount > 0) {
//             setSuccessModal({
//               visible: true,
//               message: `${successCount} photo(s) uploaded to vault!`,
//             });
//             fetchImages();
//           } else {
//             log('No successful uploads to vault.');
//           }
//         } catch (e) {
//           log('Vault upload exception:', e);
//           setErrorModal({ visible: true, message: e.message || String(e) });
//         } finally {
//           setUploading(false);
//           setProgress(0);
//           log('Vault upload flow finished. uploading=false');
//         }
//       },
//     );
//   };

//   // Move to gallery
//   const moveToGallery = async image => {
//     try {
//       const { error } = await supabase
//         .from('images')
//         .update({ private: false })
//         .eq('id', image.id);
//       if (error) {
//         setErrorModal({ visible: true, message: error.message });
//         log('Move to gallery error:', error);
//       } else {
//         setSuccessModal({ visible: true, message: 'Moved to Gallery!' });
//         fetchImages();
//       }
//     } catch (e) {
//       log('Move to gallery exception:', e);
//       setErrorModal({ visible: true, message: e.message || String(e) });
//     }
//   };

//   // Delete single
//   const confirmDeleteSingle = image => {
//     setSelectedImage(image);
//     setIsDeleteModalVisible(true);
//     log('Open delete modal for id:', image.id);
//   };

//   const handleDelete = async () => {
//     if (!selectedImage) return;
//     try {
//       const { error } = await supabase
//         .from('images')
//         .delete()
//         .eq('id', selectedImage.id);
//       if (error) {
//         setErrorModal({ visible: true, message: error.message });
//         log('Delete error:', error);
//       } else {
//         setIsDeleteModalVisible(false);
//         setSelectedImage(null);
//         fetchImages();
//         log('Deleted image id:', selectedImage.id);
//       }
//     } catch (e) {
//       log('Delete exception:', e);
//       setErrorModal({ visible: true, message: e.message || String(e) });
//     }
//   };

//   // Multi-select helpers
//   const toggleSelect = id => {
//     setSelectedIds(prev =>
//       prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id],
//     );
//     log('Toggle select id:', id);
//   };
//   const startMultiSelect = id => {
//     if (!multiSelect) setMultiSelect(true);
//     toggleSelect(id);
//     log('Start multi-select with id:', id);
//   };
//   const handleSelectAll = () => {
//     const ids = filteredImages.map(i => i.id);
//     setSelectedIds(ids);
//     setMultiSelect(true);
//     log('Selected all:', ids.length);
//   };
//   const handleBatchDelete = async () => {
//     if (!selectedIds.length) return;
//     Alert.alert('Delete', `Delete ${selectedIds.length} item(s)?`, [
//       { text: 'Cancel', style: 'cancel' },
//       {
//         text: 'Delete',
//         style: 'destructive',
//         onPress: async () => {
//           try {
//             await supabase.from('images').delete().in('id', selectedIds);
//             setSelectedIds([]);
//             setMultiSelect(false);
//             fetchImages();
//             log('Batch deleted count:', selectedIds.length);
//           } catch (e) {
//             log('Batch delete error:', e);
//             setErrorModal({ visible: true, message: e.message || String(e) });
//           }
//         },
//       },
//     ]);
//   };
//   const handleBatchMove = async () => {
//     if (!selectedIds.length) return;
//     Alert.alert(
//       'Move to Gallery',
//       `Move ${selectedIds.length} item(s) to Gallery?`,
//       [
//         { text: 'Cancel', style: 'cancel' },
//         {
//           text: 'Move',
//           onPress: async () => {
//             try {
//               await supabase
//                 .from('images')
//                 .update({ private: false })
//                 .in('id', selectedIds);
//               setSelectedIds([]);
//               setMultiSelect(false);
//               fetchImages();
//               setSuccessModal({
//                 visible: true,
//                 message: 'Moved to Gallery!',
//               });
//               log('Batch moved to gallery count:', selectedIds.length);
//             } catch (e) {
//               log('Batch move error:', e);
//               setErrorModal({
//                 visible: true,
//                 message: e.message || String(e),
//               });
//             }
//           },
//         },
//       ],
//     );
//   };

//   // Open item
//   const openItem = item => {
//     if (multiSelect) {
//       toggleSelect(item.id);
//       return;
//     }
//     const idx = filteredImages.findIndex(p => p.id === item.id);
//     setViewerIndex(Math.max(0, idx));
//     setIsViewerVisible(true);
//     setShowPhotoInfo(false);
//     setViewerFrozenSources(viewerSources); // freeze to avoid flicker
//     log('Open viewer for id:', item.id, 'index:', idx);
//   };

//   // Slideshow controls
//   const startSlideshowTimer = (reason = 'start') => {
//     if (slideshowTimer.current) clearInterval(slideshowTimer.current);
//     if (!filteredImages.length) return;

//     slideshowTimer.current = setInterval(() => {
//       setViewerIndex(prev => {
//         const next = (prev + 1) % filteredImages.length;
//         log('[Slideshow]', reason, 'tick -> next index:', next);
//         return next;
//       });
//     }, slideshowDuration);
//     log(
//       '[Slideshow] (re)started every',
//       slideshowDuration,
//       'ms reason:',
//       reason,
//     );
//   };
//   const stopSlideshowTimer = (reason = 'stop') => {
//     if (slideshowTimer.current) {
//       clearInterval(slideshowTimer.current);
//       slideshowTimer.current = null;
//       log('[Slideshow] Stopped. reason:', reason);
//     }
//   };
//   const promptSlideshowSeconds = () => {
//     setSecondsDraft(
//       Math.max(1, Math.min(30, Math.round(slideshowDuration / 1000))),
//     );
//     setSecondsModalVisible(true);
//     log('[Slideshow] Seconds picker opened');
//   };
//   const confirmSlideshowSeconds = () => {
//     const ms = Math.max(1, Math.min(30, secondsDraft)) * 1000;
//     setSecondsModalVisible(false);
//     setSlideshowDuration(ms);
//     setSlideshowActive(true);
//     startSlideshowTimer('confirm-seconds');
//     log('[Slideshow] Started with:', ms, 'ms');
//   };
//   const toggleSlideshow = () => {
//     if (slideshowActive) {
//       stopSlideshowTimer('toggle-off');
//       setSlideshowActive(false);
//       log('Slideshow stopped');
//     } else {
//       promptSlideshowSeconds();
//     }
//   };
//   useEffect(() => {
//     if (slideshowActive) {
//       startSlideshowTimer('duration-change');
//       log('Slideshow duration updated:', slideshowDuration);
//     }
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [slideshowDuration, slideshowActive, filteredImages.length]);
//   useEffect(() => {
//     return () => {
//       stopSlideshowTimer('unmount');
//       if (swipeResumeTimeoutRef.current)
//         clearTimeout(swipeResumeTimeoutRef.current);
//     };
//   }, []);

//   // Section renderer (gallery-style)
//   const renderSection = (date, imagesArr) => (
//     <Animated.View
//       key={date}
//       style={[
//         styles.section,
//         { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
//       ]}
//     >
//       <LinearGradient
//         colors={[theme.colors.ultraLight, 'transparent']}
//         start={{ x: 0, y: 0 }}
//         end={{ x: 1, y: 0 }}
//         style={styles.sectionHeaderGradient}
//       >
//         <View style={styles.sectionHeader}>
//           <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>
//             {isToday(parseISO(date))
//               ? '✨ Today'
//               : format(parseISO(date), 'MMMM d, yyyy')}
//           </Text>
//         </View>
//       </LinearGradient>
//       <FlatList
//         data={imagesArr}
//         numColumns={2}
//         keyExtractor={item => item.id.toString()}
//         renderItem={({ item }) => (
//           <PhotoGridItem
//             image={item}
//             onPress={() => openItem(item)}
//             onLongPress={() => startMultiSelect(item.id)}
//             selected={selectedIds.includes(item.id)}
//             showSelect={multiSelect}
//           />
//         )}
//         scrollEnabled={false}
//       />
//     </Animated.View>
//   );

//   // Handle unlock
//   const handleUnlock = () => {
//     if ((password || '').toUpperCase() === VAULT_PASSWORD) {
//       setUnlocked(true);
//       setPassword('');
//       log('Vault unlocked');
//     } else {
//       setWrongAttempt(true);
//       shake();
//       setTimeout(() => setWrongAttempt(false), 2000);
//       setPassword('');
//       log('Vault unlock failed');
//     }
//   };

//   // Password screen - Enhanced Design
//   if (!unlocked) {
//     return (
//       <LinearGradient
//         colors={[theme.colors.primary, theme.colors.secondary]}
//         style={styles.lockScreenGradient}
//       >
//         <SafeAreaView style={styles.lockScreen}>
//           {/* Back Button */}
//           <TouchableOpacity
//             style={styles.lockBackButton}
//             onPress={() => navigation.goBack()}
//           >
//             <Icon name="arrow-back" size={28} color="#FFFFFF" />
//           </TouchableOpacity>

//           {/* Lock Icon Container */}
//           <Animated.View
//             style={[
//               styles.lockIconContainer,
//               { transform: [{ scale: pulseAnim }] },
//             ]}
//           >
//             <LinearGradient
//               colors={['rgba(255,255,255,0.2)', 'rgba(255,255,255,0.05)']}
//               style={styles.lockIconGradient}
//             >
//               <Icon name="lock-closed" size={50} color="#FFFFFF" />
//             </LinearGradient>
//           </Animated.View>

//           {/* Title */}
//           <Text style={styles.lockTitle}>Private Vault</Text>
//           <Text style={styles.lockSubtitle}>Enter your secret password</Text>

//           {/* Password Input Container */}
//           <Animated.View
//             style={[
//               styles.passwordContainer,
//               { transform: [{ translateX: shakeAnim }] },
//             ]}
//           >
//             <View
//               style={[
//                 styles.passwordInputWrapper,
//                 wrongAttempt && styles.passwordInputError,
//               ]}
//             >
//               <Icon
//                 name="key"
//                 size={20}
//                 color={wrongAttempt ? '#FF6B6B' : 'rgba(255,255,255,0.7)'}
//               />
//               <TextInput
//                 value={password}
//                 onChangeText={setPassword}
//                 placeholder="Enter password"
//                 placeholderTextColor="rgba(255,255,255,0.4)"
//                 style={styles.passwordInput}
//                 secureTextEntry={!showPassword}
//                 autoCapitalize="characters"
//                 autoCorrect={false}
//                 maxLength={10}
//                 onSubmitEditing={handleUnlock}
//               />
//               <TouchableOpacity
//                 onPress={() => setShowPassword(!showPassword)}
//                 style={styles.eyeButton}
//               >
//                 <Icon
//                   name={showPassword ? 'eye-off' : 'eye'}
//                   size={20}
//                   color="rgba(255,255,255,0.7)"
//                 />
//               </TouchableOpacity>
//             </View>
//           </Animated.View>

//           {/* Error Message */}
//           {wrongAttempt && (
//             <Animated.View style={styles.errorContainer}>
//               <Text style={styles.errorText}>
//                 ❌ Wrong password, try again!
//               </Text>
//             </Animated.View>
//           )}

//           {/* Unlock Button */}
//           <TouchableOpacity
//             style={styles.unlockBtn}
//             onPress={handleUnlock}
//             activeOpacity={0.8}
//           >
//             <LinearGradient
//               colors={['#FFFFFF', '#F0F0F0']}
//               style={styles.unlockBtnGradient}
//             >
//               <Text
//                 style={[styles.unlockText, { color: theme.colors.primary }]}
//               >
//                 Unlock Vault
//               </Text>
//               <Icon name="lock-open" size={20} color={theme.colors.primary} />
//             </LinearGradient>
//           </TouchableOpacity>

//           {/* Hint */}
//           <View style={styles.hintContainer}>
//             <Icon
//               name="information-circle-outline"
//               size={16}
//               color="rgba(255,255,255,0.5)"
//             />
//             <Text style={styles.hintText}>
//               Password hint: It's what we share 💕
//             </Text>
//           </View>
//         </SafeAreaView>
//       </LinearGradient>
//     );
//   }

//   // Loading
//   if (loading) {
//     return (
//       <LinearGradient colors={theme.gradient} style={styles.loader}>
//         <ActivityIndicator size="large" color="#FFFFFF" />
//         <Text style={styles.loadingText}>Opening your vault...</Text>
//       </LinearGradient>
//     );
//   }

//   return (
//     <LinearGradient
//       colors={[theme.colors.ultraLight, '#FFFFFF', theme.colors.light]}
//       style={styles.container}
//     >
//       <SafeAreaView style={{ flex: 1 }}>
//         {/* Header */}
//         <Animated.View
//           style={[
//             styles.header,
//             {
//               opacity: fadeAnim,
//               transform: [
//                 {
//                   translateY: fadeAnim.interpolate({
//                     inputRange: [0, 1],
//                     outputRange: [-20, 0],
//                   }),
//                 },
//               ],
//             },
//           ]}
//         >
//           <TouchableOpacity onPress={() => navigation.goBack()}>
//             <Icon name="arrow-back" size={24} color={theme.colors.primary} />
//           </TouchableOpacity>

//           <LinearGradient
//             colors={theme.gradient}
//             start={{ x: 0, y: 0 }}
//             end={{ x: 1, y: 0 }}
//             style={styles.headerTitleContainer}
//           >
//             <Text style={styles.headerTitle}>Photo Vault 🔐</Text>
//           </LinearGradient>

//           <TouchableOpacity
//             activeOpacity={0.8}
//             onPress={() => setMultiSelect(v => !v)}
//           >
//             <Icon
//               name={multiSelect ? 'checkbox' : 'checkbox-outline'}
//               size={24}
//               color={theme.colors.primary}
//             />
//           </TouchableOpacity>
//         </Animated.View>

//         {/* Multi-select bar */}
//         {multiSelect && (
//           <Animated.View
//             style={[
//               styles.multiSelectBar,
//               {
//                 opacity: fadeAnim,
//                 transform: [
//                   {
//                     translateY: fadeAnim.interpolate({
//                       inputRange: [0, 1],
//                       outputRange: [-20, 0],
//                     }),
//                   },
//                 ],
//               },
//             ]}
//           >
//             <LinearGradient
//               colors={[
//                 theme.colors.primary + '20',
//                 theme.colors.secondary + '10',
//               ]}
//               start={{ x: 0, y: 0 }}
//               end={{ x: 1, y: 0 }}
//               style={styles.multiSelectGradient}
//             >
//               <Text
//                 style={[styles.selectedText, { color: theme.colors.primary }]}
//               >
//                 {selectedIds.length} selected
//               </Text>
//               <View style={styles.multiSelectActions}>
//                 <TouchableOpacity
//                   onPress={handleBatchMove}
//                   style={styles.multiSelectButton}
//                 >
//                   <Icon name="images" size={22} color={theme.colors.accent} />
//                 </TouchableOpacity>
//                 <TouchableOpacity
//                   onPress={handleBatchDelete}
//                   style={styles.multiSelectButton}
//                 >
//                   <Icon name="trash" size={22} color={theme.shared.red} />
//                 </TouchableOpacity>
//                 <TouchableOpacity
//                   onPress={handleSelectAll}
//                   style={styles.multiSelectButton}
//                 >
//                   <Icon
//                     name="checkmark-done"
//                     size={22}
//                     color={theme.shared.green}
//                   />
//                 </TouchableOpacity>
//                 <TouchableOpacity
//                   onPress={() => {
//                     setMultiSelect(false);
//                     setSelectedIds([]);
//                   }}
//                   style={styles.multiSelectButton}
//                 >
//                   <Icon name="close-circle" size={22} color={theme.gray.dark} />
//                 </TouchableOpacity>
//               </View>
//             </LinearGradient>
//           </Animated.View>
//         )}

//         {/* Search bar */}
//         <Animated.View
//           style={[
//             styles.searchBar,
//             { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
//           ]}
//         >
//           <LinearGradient
//             colors={['#FFFFFF', theme.colors.ultraLight]}
//             style={styles.searchGradient}
//           >
//             <Icon name="search" size={20} color={theme.colors.primary} />
//             <TextInput
//               style={[
//                 styles.searchInput,
//                 { color: theme.colors.primary, fontWeight: '500' },
//               ]}
//               placeholder="Search in vault..."
//               placeholderTextColor={theme.colors.primary + '60'}
//               value={search}
//               onChangeText={t => {
//                 setSearch(t);
//                 log('Search changed:', t);
//               }}
//               selectionColor={theme.colors.primary}
//             />
//           </LinearGradient>
//         </Animated.View>

//         {/* Empty State */}
//         {filteredImages.length === 0 && !loading && (
//           <View style={styles.emptyState}>
//             <Icon
//               name="lock-closed-outline"
//               size={80}
//               color={theme.colors.primary + '40'}
//             />
//             <Text style={[styles.emptyTitle, { color: theme.colors.primary }]}>
//               Your vault is empty
//             </Text>
//             <Text
//               style={[
//                 styles.emptySubtitle,
//                 { color: theme.colors.primary + '80' },
//               ]}
//             >
//               Tap the upload button to add private photos
//             </Text>
//           </View>
//         )}

//         {/* Sections */}
//         <ScrollView
//           contentContainerStyle={{ paddingBottom: 120 }}
//           refreshControl={
//             <RefreshControl
//               refreshing={refreshing}
//               onRefresh={onRefresh}
//               tintColor={theme.colors.primary}
//               colors={[theme.colors.primary]}
//             />
//           }
//           showsVerticalScrollIndicator={false}
//         >
//           {Object.keys(groupedImages).map(date =>
//             renderSection(date, groupedImages[date]),
//           )}
//         </ScrollView>

//         {/* Upload FAB */}
//         <TouchableOpacity
//           style={styles.fab}
//           onPress={handleImagePickAndUpload}
//           activeOpacity={0.8}
//         >
//           <LinearGradient colors={theme.gradient} style={styles.fabGradient}>
//             <Icon name="cloud-upload" size={28} color="#FFFFFF" />
//           </LinearGradient>
//         </TouchableOpacity>

//         {/* Upload Progress */}
//         {uploading && (
//           <Animated.View style={[styles.uploadStatus, { opacity: fadeAnim }]}>
//             <LinearGradient
//               colors={[
//                 theme.colors.primary + 'DD',
//                 theme.colors.secondary + 'DD',
//               ]}
//               style={styles.uploadGradient}
//             >
//               <ActivityIndicator color="white" />
//               <Text style={styles.uploadText}>Uploading... {progress}%</Text>
//             </LinearGradient>
//           </Animated.View>
//         )}

//         {/* Viewer */}
//         <ImageViewing
//           images={
//             viewerFrozenSources.length ? viewerFrozenSources : viewerSources
//           }
//           imageIndex={viewerIndex}
//           visible={isViewerVisible}
//           onRequestClose={() => {
//             setIsViewerVisible(false);
//             setViewerFrozenSources([]);
//             if (slideshowActive) {
//               stopSlideshowTimer('viewer-close');
//               setSlideshowActive(false);
//             }
//             fetchImages(); // catch up if anything changed
//           }}
//           backgroundColor="#000"
//           animationType="none"
//           doubleTapToZoomEnabled
//           swipeToCloseEnabled
//           imageContainerStyle={{ backgroundColor: '#000' }}
//           onImageIndexChange={idx => {
//             setViewerIndex(idx);
//             if (slideshowActive) {
//               pausedByUserSwipeRef.current = true;
//               stopSlideshowTimer('user-swipe');
//               setSlideshowActive(false);
//               if (swipeResumeTimeoutRef.current) {
//                 clearTimeout(swipeResumeTimeoutRef.current);
//               }
//               swipeResumeTimeoutRef.current = setTimeout(() => {
//                 if (pausedByUserSwipeRef.current) {
//                   pausedByUserSwipeRef.current = false;
//                   setSlideshowActive(true);
//                   startSlideshowTimer('resume-after-swipe');
//                 }
//               }, 600);
//             }
//           }}
//           HeaderComponent={() => {
//             const item = filteredImages[viewerIndex];
//             return (
//               <LinearGradient
//                 colors={['rgba(0,0,0,0.7)', 'transparent']}
//                 style={styles.viewerHeader}
//               >
//                 <TouchableOpacity
//                   onPress={() => {
//                     setIsViewerVisible(false);
//                     setViewerFrozenSources([]);
//                     if (slideshowActive) {
//                       stopSlideshowTimer('viewer-close-btn');
//                       setSlideshowActive(false);
//                     }
//                     fetchImages();
//                   }}
//                   style={styles.viewerCloseButton}
//                 >
//                   <Icon name="close" size={28} color="#FFFFFF" />
//                 </TouchableOpacity>
//                 <View style={styles.viewerHeaderActions}>
//                   <TouchableOpacity
//                     onPress={toggleSlideshow}
//                     style={styles.viewerHeaderButton}
//                   >
//                     <Icon
//                       name={slideshowActive ? 'pause' : 'play'}
//                       size={24}
//                       color="#FFFFFF"
//                     />
//                   </TouchableOpacity>
//                   <TouchableOpacity
//                     onPress={() => setShowPhotoInfo(v => !v)}
//                     style={styles.viewerHeaderButton}
//                   >
//                     <Icon name="information-circle" size={24} color="#FFFFFF" />
//                   </TouchableOpacity>
//                 </View>
//               </LinearGradient>
//             );
//           }}
//           FooterComponent={() => {
//             const item = filteredImages[viewerIndex];
//             if (!item) return null;
//             return (
//               <>
//                 <LinearGradient
//                   colors={['transparent', 'rgba(0,0,0,0.8)']}
//                   style={styles.viewerFooter}
//                 >
//                   {/* Move to gallery */}
//                   <TouchableOpacity
//                     style={styles.viewerButton}
//                     onPress={() => {
//                       setIsViewerVisible(false);
//                       setViewerFrozenSources([]);
//                       moveToGallery(item);
//                     }}
//                   >
//                     <Icon name="images" size={24} color="#4FC3F7" />
//                     <Text style={styles.viewerButtonText}>Gallery</Text>
//                   </TouchableOpacity>
//                   {/* Delete */}
//                   <TouchableOpacity
//                     style={styles.viewerButton}
//                     onPress={() => {
//                       setIsViewerVisible(false);
//                       setViewerFrozenSources([]);
//                       confirmDeleteSingle(item);
//                     }}
//                   >
//                     <Icon name="trash" size={24} color={theme.shared.red} />
//                     <Text style={styles.viewerButtonText}>Delete</Text>
//                   </TouchableOpacity>
//                 </LinearGradient>

//                 {/* Photo Info Overlay */}
//                 {showPhotoInfo && (
//                   <Animated.View style={styles.photoInfoOverlay}>
//                     <LinearGradient
//                       colors={['rgba(0,0,0,0.9)', 'rgba(0,0,0,0.7)']}
//                       style={styles.photoInfoContainer}
//                     >
//                       <Text style={styles.photoInfoTitle}>Photo Details</Text>
//                       <View style={styles.photoInfoRow}>
//                         <Icon
//                           name="document-text"
//                           size={16}
//                           color="#FFFFFF80"
//                         />
//                         <Text style={styles.photoInfoText}>
//                           {item.file_name || 'Untitled'}
//                         </Text>
//                       </View>
//                       <View style={styles.photoInfoRow}>
//                         <Icon name="calendar" size={16} color="#FFFFFF80" />
//                         <Text style={styles.photoInfoText}>
//                           {format(parseISO(item.created_at), 'PPpp')}
//                         </Text>
//                       </View>
//                       <View style={styles.photoInfoRow}>
//                         <Icon name="lock-closed" size={16} color="#FFFFFF80" />
//                         <Text style={styles.photoInfoText}>Private</Text>
//                       </View>
//                     </LinearGradient>
//                   </Animated.View>
//                 )}
//               </>
//             );
//           }}
//         />

//         {/* Seconds modal */}
//         <Modal
//           isVisible={secondsModalVisible}
//           onBackdropPress={() => setSecondsModalVisible(false)}
//           onBackButtonPress={() => setSecondsModalVisible(false)}
//           backdropOpacity={0.5}
//           useNativeDriver
//         >
//           <View style={styles.secondsModal}>
//             <Text style={styles.secondsTitle}>Slideshow Interval</Text>

//             <View style={styles.secondsChips}>
//               {[3, 5, 10, 15].map(s => (
//                 <TouchableOpacity
//                   key={s}
//                   style={[
//                     styles.secondsChip,
//                     secondsDraft === s && styles.secondsChipActive,
//                   ]}
//                   onPress={() => setSecondsDraft(s)}
//                 >
//                   <Text
//                     style={[
//                       styles.secondsChipText,
//                       secondsDraft === s && styles.secondsChipTextActive,
//                     ]}
//                   >
//                     {s} sec
//                   </Text>
//                 </TouchableOpacity>
//               ))}
//             </View>

//             <View style={styles.secondsRow}>
//               <TouchableOpacity
//                 onPress={() => setSecondsDraft(v => Math.max(1, v - 1))}
//                 style={styles.secondsBtn}
//               >
//                 <Icon name="remove" size={22} color="#fff" />
//               </TouchableOpacity>
//               <Text style={styles.secondsValue}>{secondsDraft}s</Text>
//               <TouchableOpacity
//                 onPress={() => setSecondsDraft(v => Math.min(30, v + 1))}
//                 style={styles.secondsBtn}
//               >
//                 <Icon name="add" size={22} color="#fff" />
//               </TouchableOpacity>
//             </View>

//             <View style={styles.secondsActions}>
//               <TouchableOpacity
//                 onPress={() => setSecondsModalVisible(false)}
//                 style={[styles.secondsActionBtn, { backgroundColor: '#555' }]}
//               >
//                 <Text style={styles.secondsActionText}>Cancel</Text>
//               </TouchableOpacity>
//               <TouchableOpacity
//                 onPress={confirmSlideshowSeconds}
//                 style={[
//                   styles.secondsActionBtn,
//                   { backgroundColor: theme.colors.primary },
//                 ]}
//               >
//                 <Text style={styles.secondsActionText}>Start</Text>
//               </TouchableOpacity>
//             </View>
//           </View>
//         </Modal>

//         {/* Delete Modal */}
//         <Modal isVisible={isDeleteModalVisible}>
//           <View style={styles.modalContent}>
//             <Icon name="trash-outline" size={50} color={theme.shared.red} />
//             <Text style={styles.modalTitle}>Delete Photo</Text>
//             <Text style={styles.modalMessage}>
//               Are you sure you want to delete this photo from your vault? This
//               action cannot be undone.
//             </Text>
//             <View style={styles.modalActions}>
//               <TouchableOpacity
//                 style={[styles.modalButton, styles.modalButtonCancel]}
//                 onPress={() => setIsDeleteModalVisible(false)}
//               >
//                 <Text style={styles.modalButtonCancelText}>Cancel</Text>
//               </TouchableOpacity>
//               <TouchableOpacity
//                 style={[styles.modalButton, styles.modalButtonDelete]}
//                 onPress={handleDelete}
//               >
//                 <Text style={styles.modalButtonText}>Delete</Text>
//               </TouchableOpacity>
//             </View>
//           </View>
//         </Modal>

//         {/* Error & Success */}
//         <ErrorModal
//           visible={errorModal.visible}
//           message={errorModal.message}
//           onClose={() => setErrorModal({ visible: false, message: '' })}
//           theme={theme}
//         />
//         <ErrorModal
//           visible={successModal.visible}
//           message={successModal.message}
//           onClose={() => setSuccessModal({ visible: false, message: '' })}
//           theme={theme}
//         />
//       </SafeAreaView>
//     </LinearGradient>
//   );
// };

// const styles = StyleSheet.create({
//   container: { flex: 1 },
//   loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
//   loadingText: {
//     color: '#FFFFFF',
//     fontSize: 18,
//     marginTop: 16,
//     fontWeight: '600',
//   },

//   // Enhanced Lock Screen Styles
//   lockScreenGradient: {
//     flex: 1,
//   },
//   lockScreen: {
//     flex: 1,
//     justifyContent: 'center',
//     alignItems: 'center',
//     paddingHorizontal: 24,
//   },
//   lockBackButton: {
//     position: 'absolute',
//     top: 50,
//     left: 20,
//     padding: 10,
//     backgroundColor: 'rgba(255,255,255,0.1)',
//     borderRadius: 25,
//   },
//   lockIconContainer: {
//     marginBottom: 30,
//   },
//   lockIconGradient: {
//     width: 120,
//     height: 120,
//     borderRadius: 60,
//     justifyContent: 'center',
//     alignItems: 'center',
//     borderWidth: 2,
//     borderColor: 'rgba(255,255,255,0.3)',
//   },
//   lockTitle: {
//     fontSize: 32,
//     fontWeight: 'bold',
//     color: '#FFFFFF',
//     marginBottom: 8,
//     letterSpacing: 1,
//   },
//   lockSubtitle: {
//     fontSize: 16,
//     color: 'rgba(255,255,255,0.8)',
//     marginBottom: 40,
//   },
//   passwordContainer: {
//     width: '100%',
//     marginBottom: 20,
//   },
//   passwordInputWrapper: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     backgroundColor: 'rgba(255,255,255,0.15)',
//     borderRadius: 16,
//     paddingHorizontal: 20,
//     paddingVertical: 4,
//     borderWidth: 2,
//     borderColor: 'rgba(255,255,255,0.2)',
//   },
//   passwordInputError: {
//     borderColor: '#FF6B6B',
//     backgroundColor: 'rgba(255,107,107,0.1)',
//   },
//   passwordInput: {
//     flex: 1,
//     fontSize: 18,
//     color: '#FFFFFF',
//     paddingVertical: 16,
//     paddingHorizontal: 12,
//     fontWeight: '500',
//     letterSpacing: 4,
//   },
//   eyeButton: {
//     padding: 8,
//   },
//   errorContainer: {
//     backgroundColor: 'rgba(255,107,107,0.2)',
//     paddingHorizontal: 20,
//     paddingVertical: 10,
//     borderRadius: 12,
//     marginBottom: 20,
//   },
//   errorText: {
//     color: '#FFFFFF',
//     fontSize: 14,
//     fontWeight: '600',
//   },
//   unlockBtn: {
//     width: '100%',
//     marginTop: 10,
//   },
//   unlockBtnGradient: {
//     flexDirection: 'row',
//     justifyContent: 'center',
//     alignItems: 'center',
//     paddingVertical: 16,
//     borderRadius: 16,
//     elevation: 5,
//     shadowColor: '#000',
//     shadowOpacity: 0.3,
//     shadowRadius: 8,
//     shadowOffset: { width: 0, height: 4 },
//   },
//   unlockText: {
//     fontSize: 18,
//     fontWeight: 'bold',
//     marginRight: 8,
//   },
//   hintContainer: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     marginTop: 30,
//     paddingHorizontal: 20,
//     paddingVertical: 10,
//     backgroundColor: 'rgba(255,255,255,0.1)',
//     borderRadius: 20,
//   },
//   hintText: {
//     color: 'rgba(255,255,255,0.7)',
//     fontSize: 13,
//     marginLeft: 6,
//     fontStyle: 'italic',
//   },

//   // Header
//   header: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     paddingHorizontal: 16,
//     paddingVertical: 12,
//     justifyContent: 'space-between',
//   },
//   headerTitleContainer: {
//     flex: 1,
//     paddingVertical: 8,
//     paddingHorizontal: 16,
//     borderRadius: 20,
//     marginHorizontal: 12,
//   },
//   headerTitle: {
//     fontSize: 20,
//     fontWeight: 'bold',
//     color: '#FFFFFF',
//     textAlign: 'center',
//   },

//   // Search
//   searchBar: {
//     marginHorizontal: 16,
//     marginBottom: 12,
//   },
//   searchGradient: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     borderRadius: 25,
//     paddingHorizontal: 16,
//     paddingVertical: 12,
//     elevation: 4,
//     shadowColor: '#000',
//     shadowOpacity: 0.1,
//     shadowRadius: 4,
//     shadowOffset: { width: 0, height: 2 },
//   },
//   searchInput: {
//     flex: 1,
//     marginLeft: 12,
//     fontSize: 16,
//   },

//   // Empty State
//   emptyState: {
//     flex: 1,
//     justifyContent: 'center',
//     alignItems: 'center',
//     padding: 40,
//   },
//   emptyTitle: {
//     fontSize: 22,
//     fontWeight: 'bold',
//     marginTop: 20,
//     marginBottom: 8,
//   },
//   emptySubtitle: {
//     fontSize: 16,
//     textAlign: 'center',
//   },

//   // Sections
//   section: {
//     marginBottom: 24,
//     marginHorizontal: 16,
//   },
//   sectionHeaderGradient: { borderRadius: 12, marginBottom: 12 },
//   sectionHeader: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     alignItems: 'center',
//     paddingVertical: 8,
//     paddingHorizontal: 12,
//   },
//   sectionTitle: { fontSize: 18, fontWeight: 'bold' },

//   // FAB
//   fab: {
//     position: 'absolute',
//     right: 24,
//     bottom: 100,
//     zIndex: 10,
//   },
//   fabGradient: {
//     width: 60,
//     height: 60,
//     borderRadius: 30,
//     justifyContent: 'center',
//     alignItems: 'center',
//     elevation: 8,
//     shadowColor: '#000',
//     shadowOpacity: 0.3,
//     shadowRadius: 8,
//     shadowOffset: { width: 0, height: 4 },
//   },

//   // Upload status
//   uploadStatus: {
//     position: 'absolute',
//     bottom: 140,
//     alignSelf: 'center',
//     zIndex: 10,
//   },
//   uploadGradient: {
//     paddingVertical: 12,
//     paddingHorizontal: 24,
//     borderRadius: 25,
//     flexDirection: 'row',
//     alignItems: 'center',
//   },
//   uploadText: {
//     marginLeft: 12,
//     fontSize: 16,
//     color: 'white',
//     fontWeight: '600',
//   },

//   // Multi-select bar
//   multiSelectBar: { marginHorizontal: 16, marginBottom: 12 },
//   multiSelectGradient: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     borderRadius: 20,
//     padding: 12,
//     justifyContent: 'space-between',
//     elevation: 2,
//   },
//   selectedText: { fontWeight: 'bold', fontSize: 16 },
//   multiSelectActions: { flexDirection: 'row', alignItems: 'center' },
//   multiSelectButton: {
//     padding: 8,
//     marginHorizontal: 4,
//     backgroundColor: 'rgba(255,255,255,0.8)',
//     borderRadius: 20,
//   },

//   // Viewer
//   viewerHeader: {
//     position: 'absolute',
//     top: 0,
//     left: 0,
//     right: 0,
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     alignItems: 'center',
//     paddingTop: 20,
//     paddingHorizontal: 20,
//     paddingBottom: 20,
//     zIndex: 10,
//   },
//   viewerCloseButton: { padding: 8 },
//   viewerHeaderActions: { flexDirection: 'row', alignItems: 'center' },
//   viewerHeaderButton: { padding: 8, marginLeft: 16 },
//   viewerFooter: {
//     flexDirection: 'row',
//     justifyContent: 'center',
//     alignItems: 'center',
//     paddingVertical: 20,
//     paddingHorizontal: 16,
//     position: 'absolute',
//     bottom: 0,
//     width: '100%',
//   },
//   viewerButton: {
//     backgroundColor: 'rgba(255,255,255,0.2)',
//     paddingVertical: 10,
//     paddingHorizontal: 14,
//     borderRadius: 25,
//     marginHorizontal: 8,
//     flexDirection: 'row',
//     alignItems: 'center',
//   },
//   viewerButtonText: {
//     color: '#FFFFFF',
//     fontSize: 14,
//     marginLeft: 6,
//     fontWeight: '600',
//   },

//   // Photo Info Overlay
//   photoInfoOverlay: {
//     position: 'absolute',
//     bottom: 100,
//     left: 20,
//     right: 20,
//   },
//   photoInfoContainer: {
//     borderRadius: 16,
//     padding: 16,
//   },
//   photoInfoTitle: {
//     color: '#FFFFFF',
//     fontSize: 18,
//     fontWeight: 'bold',
//     marginBottom: 12,
//   },
//   photoInfoRow: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     marginBottom: 8,
//   },
//   photoInfoText: {
//     color: '#FFFFFF',
//     fontSize: 14,
//     marginLeft: 8,
//   },

//   // Seconds modal
//   secondsModal: {
//     backgroundColor: '#222',
//     padding: 24,
//     borderRadius: 20,
//     alignItems: 'center',
//   },
//   secondsTitle: {
//     color: '#fff',
//     fontWeight: '700',
//     fontSize: 18,
//     marginBottom: 20,
//     textAlign: 'center',
//   },
//   secondsChips: {
//     flexDirection: 'row',
//     flexWrap: 'wrap',
//     justifyContent: 'center',
//     marginBottom: 20,
//   },
//   secondsChip: {
//     paddingHorizontal: 16,
//     paddingVertical: 8,
//     borderRadius: 20,
//     backgroundColor: '#333',
//     margin: 6,
//   },
//   secondsChipActive: {
//     backgroundColor: '#555',
//     borderWidth: 1,
//     borderColor: '#888',
//   },
//   secondsChipText: { color: '#eee', fontSize: 14, fontWeight: '600' },
//   secondsChipTextActive: { color: '#fff' },
//   secondsRow: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     justifyContent: 'center',
//     marginBottom: 20,
//   },
//   secondsBtn: {
//     width: 48,
//     height: 48,
//     borderRadius: 24,
//     alignItems: 'center',
//     justifyContent: 'center',
//     backgroundColor: '#444',
//   },
//   secondsValue: {
//     color: '#fff',
//     fontWeight: '700',
//     fontSize: 24,
//     marginHorizontal: 24,
//     minWidth: 50,
//     textAlign: 'center',
//   },
//   secondsActions: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     width: '100%',
//   },
//   secondsActionBtn: {
//     flex: 1,
//     paddingVertical: 12,
//     borderRadius: 14,
//     marginHorizontal: 8,
//     alignItems: 'center',
//   },
//   secondsActionText: { color: '#fff', fontWeight: '700', fontSize: 16 },

//   // Delete modal - Enhanced
//   modalContent: {
//     backgroundColor: '#fff',
//     padding: 28,
//     borderRadius: 20,
//     alignItems: 'center',
//   },
//   modalTitle: {
//     fontSize: 20,
//     fontWeight: 'bold',
//     color: '#333',
//     marginTop: 16,
//     marginBottom: 12,
//   },
//   modalMessage: {
//     fontSize: 15,
//     color: '#666',
//     textAlign: 'center',
//     marginBottom: 24,
//     lineHeight: 22,
//   },
//   modalActions: {
//     flexDirection: 'row',
//     width: '100%',
//   },
//   modalButton: {
//     flex: 1,
//     paddingVertical: 14,
//     borderRadius: 12,
//     marginHorizontal: 8,
//     alignItems: 'center',
//   },
//   modalButtonCancel: {
//     backgroundColor: '#E0E0E0',
//   },
//   modalButtonCancelText: {
//     color: '#666',
//     fontWeight: '600',
//     fontSize: 16,
//   },
//   modalButtonDelete: {
//     backgroundColor: '#FF5252',
//   },
//   modalButtonText: {
//     color: '#fff',
//     fontWeight: '600',
//     fontSize: 16,
//   },
// });

// export default PhotoVaultScreen;
