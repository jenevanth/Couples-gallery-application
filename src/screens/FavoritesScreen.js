// FavoritesScreen.js - Complete with all GalleryScreen features
import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  ScrollView,
  Alert,
  PermissionsAndroid,
  ToastAndroid,
  Animated,
  Dimensions,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { supabase } from '../services/supabase';
import PhotoGridItem from '../components/PhotoGridItem';
import ImageViewing from 'react-native-image-viewing';
import Share from 'react-native-share';
import BlobUtil from 'react-native-blob-util';
import Icon from 'react-native-vector-icons/Ionicons';
import Modal from 'react-native-modal';
import ErrorModal from '../components/ErrorModal';
import LinearGradient from 'react-native-linear-gradient';
import { format, parseISO } from 'date-fns';
import { useFocusEffect } from '@react-navigation/native';

// Constants
const REACTIONS = ['❤️', '😍', '🔥', '💕', '✨', '😊'];
const SLIDESHOW_DURATIONS = [
  { label: '3 sec', value: 3000 },
  { label: '5 sec', value: 5000 },
  { label: '10 sec', value: 10000 },
  { label: '15 sec', value: 15000 },
];

const { width, height } = Dimensions.get('window');

const FavoritesScreen = ({ navigation }) => {
  const { theme } = useTheme();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const reactionAnim = useRef(new Animated.Value(0)).current;

  // Data states
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userId, setUserId] = useState('');
  const [userName, setUserName] = useState('');

  // Viewer (flicker-free)
  const [isViewerVisible, setIsViewerVisible] = useState(false);
  const [viewerStartIndex, setViewerStartIndex] = useState(0);
  const currentIndexRef = useRef(0);
  const [viewerFrozenSources, setViewerFrozenSources] = useState([]);
  const viewerOpenRef = useRef(false);
  useEffect(() => {
    viewerOpenRef.current = isViewerVisible;
  }, [isViewerVisible]);

  // UI toggles
  const [showPhotoInfo, setShowPhotoInfo] = useState(false);
  const [slideshowActive, setSlideshowActive] = useState(false);
  const [slideshowDuration, setSlideshowDuration] = useState(5000);
  const [showDurationPicker, setShowDurationPicker] = useState(false); // legacy overlay retained
  const [secondsModalVisible, setSecondsModalVisible] = useState(false);
  const [secondsDraft, setSecondsDraft] = useState(5);

  // Reactions
  const [showReactions, setShowReactions] = useState(false);
  const [imageReactions, setImageReactions] = useState({});

  // Multi-select
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);

  // Modals
  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [errorModal, setErrorModal] = useState({ visible: false, message: '' });
  const [successModal, setSuccessModal] = useState({
    visible: false,
    message: '',
  });

  // Slideshow timer
  const slideshowTimer = useRef(null);
  const pausedByUserSwipeRef = useRef(false);
  const swipeResumeTimeoutRef = useRef(null);

  // Animations
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
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Debug log for every render
  console.log('[FavoritesScreen] Render', {
    loading,
    imagesCount: images.length,
    multiSelect,
    selectedIds: selectedIds.length,
    slideshowActive,
    slideshowDuration,
  });

  // Get user info
  useEffect(() => {
    const getUserInfo = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);
        const { data } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', user.id)
          .maybeSingle();
        setUserName(data?.username || 'User');
      }
    };
    getUserInfo();
  }, []);

  // Fetch favorites from Supabase
  const fetchFavorites = useCallback(async () => {
    console.log(
      '[FavoritesScreen] --- Fetching favorites from Supabase... ---',
    );
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('images')
        .select('*')
        .eq('favorite', true)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setImages(data || []);
      console.log(
        '[FavoritesScreen] Supabase fetch success. Images:',
        data?.length,
      );
    } catch (error) {
      console.log('[FavoritesScreen] Fetch error:', error);
      setErrorModal({ visible: true, message: error.message });
      setImages([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Fetch reactions
  const fetchReactions = useCallback(async () => {
    try {
      const { data: reactions } = await supabase.from('reactions').select('*');

      // Group reactions by image_id
      const reactionsByImage = {};
      reactions?.forEach(r => {
        if (!reactionsByImage[r.image_id]) reactionsByImage[r.image_id] = [];
        reactionsByImage[r.image_id].push(r);
      });
      setImageReactions(reactionsByImage);

      console.log('[FavoritesScreen] Fetched reactions');
    } catch (e) {
      console.log('[FavoritesScreen] Error fetching reactions:', e);
    }
  }, []);

  // Initial load and realtime subscription
  useEffect(() => {
    fetchFavorites();
    fetchReactions();

    const imagesChannel = supabase
      .channel('public:images:favorites')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'images' },
        payload => {
          console.log(
            '[FavoritesScreen] Realtime event received:',
            payload.eventType,
          );
          fetchFavorites();
        },
      )
      .subscribe();

    const reactionsChannel = supabase
      .channel('public:reactions:favorites')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reactions' },
        () => {
          fetchReactions();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(imagesChannel);
      supabase.removeChannel(reactionsChannel);
    };
  }, [fetchFavorites, fetchReactions]);

  // Focus effect
  useFocusEffect(
    useCallback(() => {
      fetchFavorites();
      fetchReactions();
    }, [fetchFavorites, fetchReactions]),
  );

  // Pull to refresh
  const onRefresh = () => {
    setRefreshing(true);
    fetchFavorites();
    fetchReactions();
  };

  // Viewer sources
  const viewerSources = useMemo(
    () => images.map(img => ({ uri: img.image_url })),
    [images],
  );

  // Open image viewer (flicker-free)
  const openImage = index => {
    setViewerStartIndex(index);
    currentIndexRef.current = index;
    setIsViewerVisible(true);
    setShowReactions(false);
    setShowPhotoInfo(false);
    setShowDurationPicker(false);
    setViewerFrozenSources(viewerSources); // freeze to avoid flicker
    console.log(
      '[FavoritesScreen] Opened viewer for image:',
      images[index]?.id,
      'at index',
      index,
    );
  };

  // Delete image (accept item)
  const handleDeleteItem = async item => {
    if (!item) return;
    Alert.alert('Delete', 'Delete this photo?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const { error } = await supabase
              .from('images')
              .delete()
              .eq('id', item.id);
            if (error) throw error;

            setIsViewerVisible(false);
            setViewerFrozenSources([]);
            fetchFavorites();
            console.log('[FavoritesScreen] Deleted image:', item.id);
          } catch (error) {
            setErrorModal({ visible: true, message: error.message });
          }
        },
      },
    ]);
  };

  // Share image (accept item)
  const handleShareItem = async item => {
    try {
      if (!item) return;
      await Share.open({ url: item.image_url });
      console.log('[FavoritesScreen] Shared image:', item.image_url);
    } catch (e) {
      if (e?.message !== 'User did not share') {
        setErrorModal({ visible: true, message: e.message });
      }
    }
  };

  // Save image with permissions (accept item)
  const handleSaveItem = async item => {
    try {
      if (!item) return;

      // Request permissions for Android
      if (Platform.OS === 'android') {
        try {
          const androidVersion = Platform.Version;

          if (androidVersion >= 33) {
            // Android 13+
            const granted = await PermissionsAndroid.requestMultiple([
              PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
              PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO,
            ]);

            const allGranted = Object.values(granted).every(
              p => p === PermissionsAndroid.RESULTS.GRANTED,
            );

            if (!allGranted) {
              setErrorModal({
                visible: true,
                message: 'Storage permission required',
              });
              return;
            }
          } else {
            // Android 12 and below
            const granted = await PermissionsAndroid.request(
              PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
              {
                title: 'Storage Permission Required',
                message: 'This app needs access to your storage to save photos',
                buttonNeutral: 'Ask Me Later',
                buttonNegative: 'Cancel',
                buttonPositive: 'OK',
              },
            );

            if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
              setErrorModal({
                visible: true,
                message: 'Storage permission required',
              });
              return;
            }
          }
        } catch (err) {
          console.warn('Permission error:', err);
        }
      }

      const fileUrl = item.image_url;
      const fileName =
        item.file_name || fileUrl.split('/').pop() || `image_${Date.now()}.jpg`;
      const dirs = BlobUtil.fs.dirs;

      const dest =
        Platform.OS === 'android'
          ? `${dirs.PictureDir}/Favorites/${fileName}`
          : `${dirs.DocumentDir}/${fileName}`;

      console.log('[FavoritesScreen] Saving file to device...', {
        dest,
        fileUrl,
      });

      if (Platform.OS === 'android') {
        const configOptions = {
          fileCache: true,
          addAndroidDownloads: {
            useDownloadManager: true,
            notification: true,
            mediaScannable: true,
            title: fileName,
            path: dest,
            description: 'Downloading image...',
          },
        };

        await BlobUtil.config(configOptions).fetch('GET', fileUrl);
        ToastAndroid.show(
          `Saved to Pictures/Favorites/${fileName}`,
          ToastAndroid.LONG,
        );
      } else {
        await BlobUtil.config({ path: dest }).fetch('GET', fileUrl);
      }

      setSuccessModal({ visible: true, message: 'Image saved successfully!' });
      console.log('[FavoritesScreen] Saved file to:', dest);
    } catch (e) {
      console.log('[FavoritesScreen] Save error:', e);
      setErrorModal({ visible: true, message: 'Failed to save: ' + e.message });
    }
  };

  // Toggle favorite (accept item)
  const handleToggleFavoriteItem = async item => {
    if (!item) return;

    try {
      const updated = !item.favorite;
      await supabase
        .from('images')
        .update({ favorite: updated })
        .eq('id', item.id);

      if (!updated) {
        // If unfavorited, remove from list
        setImages(prev => prev.filter(img => img.id !== item.id));
        setIsViewerVisible(false);
        setViewerFrozenSources([]);
      } else {
        setImages(prev =>
          prev.map(img =>
            img.id === item.id ? { ...img, favorite: updated } : img,
          ),
        );
      }

      console.log(
        '[FavoritesScreen] Toggled favorite for image:',
        item.id,
        'Now:',
        updated,
      );
    } catch (e) {
      setErrorModal({ visible: true, message: e.message });
    }
  };

  // Toggle reaction (accept emoji + item)
  const toggleReaction = async (emoji, item) => {
    if (!item) return;

    try {
      const existingReactions = imageReactions[item.id] || [];
      const userReaction = existingReactions.find(
        r => r.user_id === userId && r.emoji === emoji,
      );

      if (userReaction) {
        console.log('[FavoritesScreen] Removing reaction:', emoji);
        const { error } = await supabase
          .from('reactions')
          .delete()
          .match({ image_id: item.id, user_id: userId, emoji });

        if (error) throw error;

        setImageReactions(prev => ({
          ...prev,
          [item.id]: prev[item.id].filter(
            r => !(r.user_id === userId && r.emoji === emoji),
          ),
        }));
      } else {
        console.log('[FavoritesScreen] Adding reaction:', emoji);
        Animated.sequence([
          Animated.timing(reactionAnim, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(reactionAnim, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
          }),
        ]).start();

        const { error } = await supabase.from('reactions').insert({
          image_id: item.id,
          user_id: userId,
          emoji,
          created_at: new Date().toISOString(),
        });

        if (error) throw error;

        setImageReactions(prev => ({
          ...prev,
          [item.id]: [...(prev[item.id] || []), { user_id: userId, emoji }],
        }));
      }
    } catch (e) {
      console.log('[FavoritesScreen] Error toggling reaction:', e);
      setErrorModal({ visible: true, message: 'Failed to update reaction' });
    }
  };

  // Slideshow functions (ref-based)
  const startSlideshowTimer = (reason = 'start') => {
    if (slideshowTimer.current) {
      clearInterval(slideshowTimer.current);
    }
    if (!images.length) return;

    slideshowTimer.current = setInterval(() => {
      const next = (currentIndexRef.current + 1) % images.length;
      currentIndexRef.current = next;
      setViewerStartIndex(next); // minimal state update, no flicker
      console.log('[FavoritesScreen] Slideshow next:', next, 'reason:', reason);
    }, slideshowDuration);
    console.log(
      '[FavoritesScreen] Slideshow started with duration:',
      slideshowDuration,
      'reason:',
      reason,
    );
  };
  const stopSlideshowTimer = (reason = 'stop') => {
    if (slideshowTimer.current) {
      clearInterval(slideshowTimer.current);
      slideshowTimer.current = null;
      console.log('[FavoritesScreen] Slideshow stopped. reason:', reason);
    }
  };
  const toggleSlideshow = () => {
    if (slideshowActive) {
      stopSlideshowTimer('toggle-off');
      setSlideshowActive(false);
    } else {
      // Open seconds picker modal like other screens
      setSecondsDraft(
        Math.max(1, Math.min(30, Math.round(slideshowDuration / 1000))),
      );
      setSecondsModalVisible(true);
    }
  };
  const confirmSlideshowSeconds = () => {
    const ms = Math.max(1, Math.min(30, secondsDraft)) * 1000;
    setSecondsModalVisible(false);
    setSlideshowDuration(ms);
    setSlideshowActive(true);
    startSlideshowTimer('confirm-seconds');
  };

  useEffect(() => {
    if (slideshowActive) {
      startSlideshowTimer('duration-change');
    }
  }, [slideshowDuration, slideshowActive, images.length]);

  // Cleanup slideshow on unmount
  useEffect(() => {
    return () => {
      if (slideshowTimer.current) {
        clearInterval(slideshowTimer.current);
      }
      if (swipeResumeTimeoutRef.current)
        clearTimeout(swipeResumeTimeoutRef.current);
    };
  }, []);

  // Multi-select functions
  const toggleSelect = id => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id],
    );
  };

  const startMultiSelect = id => {
    if (!multiSelect) setMultiSelect(true);
    toggleSelect(id);
  };

  const handleBatchDelete = async () => {
    if (!selectedIds.length) return;
    Alert.alert('Delete', `Delete ${selectedIds.length} item(s)?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('images').delete().in('id', selectedIds);
          setSelectedIds([]);
          setMultiSelect(false);
          fetchFavorites();
        },
      },
    ]);
  };

  const handleBatchShare = async () => {
    if (!selectedIds.length) return;
    const urls = images
      .filter(i => selectedIds.includes(i.id))
      .map(i => i.image_url);
    try {
      await Share.open({ urls });
    } catch (e) {
      console.log('[FavoritesScreen] Batch share error:', e);
    }
  };

  const handleBatchUnfavorite = async () => {
    if (!selectedIds.length) return;
    try {
      await supabase
        .from('images')
        .update({ favorite: false })
        .in('id', selectedIds);
      setSelectedIds([]);
      setMultiSelect(false);
      fetchFavorites();
    } catch (e) {
      setErrorModal({ visible: true, message: e.message });
    }
  };

  // Render each image in grid
  const renderItem = ({ item, index }) => (
    <PhotoGridItem
      image={item}
      onPress={() => (multiSelect ? toggleSelect(item.id) : openImage(index))}
      onLongPress={() => startMultiSelect(item.id)}
      selected={selectedIds.includes(item.id)}
      showSelect={multiSelect}
    />
  );

  // Loading state
  if (loading) {
    return (
      <LinearGradient colors={theme.gradient} style={styles.loader}>
        <ActivityIndicator size="large" color="#FFFFFF" />
        <Text style={styles.loadingText}>Loading your favorites...</Text>
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
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          <LinearGradient
            colors={theme.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.headerTitleContainer}
          >
            <Icon
              name="heart"
              size={24}
              color="#FFFFFF"
              style={{ marginRight: 8 }}
            />
            <Text style={styles.title}>Favorites</Text>
            <Text style={styles.subtitle}>{images.length} memories</Text>
          </LinearGradient>

          {images.length > 0 && (
            <TouchableOpacity
              onPress={() => setMultiSelect(v => !v)}
              style={styles.selectButton}
            >
              <Icon
                name={multiSelect ? 'checkbox' : 'checkbox-outline'}
                size={28}
                color={theme.colors.primary}
              />
            </TouchableOpacity>
          )}
        </Animated.View>

        {/* Multi-select bar */}
        {multiSelect && (
          <Animated.View style={[styles.multiSelectBar, { opacity: fadeAnim }]}>
            <LinearGradient
              colors={[
                theme.colors.primary + '20',
                theme.colors.secondary + '10',
              ]}
              style={styles.multiSelectGradient}
            >
              <Text
                style={[styles.selectedText, { color: theme.colors.primary }]}
              >
                {selectedIds.length} selected
              </Text>
              <View style={styles.multiSelectActions}>
                <TouchableOpacity
                  onPress={handleBatchShare}
                  style={styles.multiSelectButton}
                >
                  <Icon
                    name="share-social"
                    size={22}
                    color={theme.colors.accent}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleBatchUnfavorite}
                  style={styles.multiSelectButton}
                >
                  <Icon
                    name="heart-dislike"
                    size={22}
                    color={theme.shared.orange}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleBatchDelete}
                  style={styles.multiSelectButton}
                >
                  <Icon name="trash" size={22} color={theme.shared.red} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setSelectedIds(images.map(i => i.id))}
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

        {/* Content */}
        {images.length === 0 ? (
          <View style={styles.emptyState}>
            <Icon name="heart-outline" size={80} color={theme.colors.primary} />
            <Text style={[styles.emptyText, { color: theme.gray.medium }]}>
              No favorites yet!
            </Text>
            <Text style={[styles.emptySubtext, { color: theme.gray.light }]}>
              Tap the heart icon on photos to add them here
            </Text>
          </View>
        ) : (
          <FlatList
            data={images}
            numColumns={2}
            keyExtractor={item => item.id.toString()}
            contentContainerStyle={styles.grid}
            renderItem={renderItem}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={theme.colors.primary}
                colors={[theme.colors.primary]}
              />
            }
          />
        )}

        {/* Black backdrop under viewer */}
        {isViewerVisible && (
          <View pointerEvents="none" style={styles.viewerBackdrop} />
        )}

        {/* Enhanced Image Viewer (flicker-free) */}
        <ImageViewing
          images={
            viewerFrozenSources.length ? viewerFrozenSources : viewerSources
          }
          imageIndex={viewerStartIndex}
          visible={isViewerVisible}
          onRequestClose={() => {
            setIsViewerVisible(false);
            setViewerFrozenSources([]);
            if (slideshowActive) toggleSlideshow();
          }}
          doubleTapToZoomEnabled
          swipeToCloseEnabled
          onImageIndexChange={idx => {
            // avoid state updates on swipe (no flicker)
            currentIndexRef.current = idx;
            setShowReactions(false);
            setShowPhotoInfo(false);
            setShowDurationPicker(false);

            // Pause slideshow and resume after slight delay
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
          HeaderComponent={() => (
            <LinearGradient
              colors={['rgba(0,0,0,0.7)', 'transparent']}
              style={styles.viewerHeader}
            >
              <TouchableOpacity
                onPress={() => {
                  setIsViewerVisible(false);
                  setViewerFrozenSources([]);
                  if (slideshowActive) toggleSlideshow();
                }}
                style={styles.viewerCloseButton}
              >
                <Icon name="close" size={28} color="#FFFFFF" />
              </TouchableOpacity>
              <View style={styles.viewerHeaderActions}>
                <TouchableOpacity
                  onPress={() => {
                    setSecondsDraft(
                      Math.max(
                        1,
                        Math.min(30, Math.round(slideshowDuration / 1000)),
                      ),
                    );
                    setSecondsModalVisible(true);
                  }}
                  style={styles.viewerHeaderButton}
                >
                  <Icon name="time" size={24} color="#FFFFFF" />
                </TouchableOpacity>
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
            const image = images[imageIndex];
            if (!image) return null;
            const reactions = imageReactions[image.id] || [];

            return (
              <View>
                {/* Slideshow Duration Picker (legacy overlay) */}
                {showDurationPicker && (
                  <View style={styles.durationPicker}>
                    {SLIDESHOW_DURATIONS.map(duration => (
                      <TouchableOpacity
                        key={duration.value}
                        onPress={() => {
                          setSlideshowDuration(duration.value);
                          setShowDurationPicker(false);
                          console.log(
                            '[FavoritesScreen] Duration set to:',
                            duration.label,
                          );
                        }}
                        style={[
                          styles.durationOption,
                          slideshowDuration === duration.value &&
                            styles.durationOptionActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.durationText,
                            slideshowDuration === duration.value &&
                              styles.durationTextActive,
                          ]}
                        >
                          {duration.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Photo Info Panel */}
                {showPhotoInfo && (
                  <LinearGradient
                    colors={['transparent', 'rgba(0,0,0,0.9)']}
                    style={styles.photoInfoPanel}
                  >
                    <Text style={styles.photoInfoTitle}>Photo Details</Text>
                    <Text style={styles.photoInfoText}>
                      Name: {image.file_name || 'Untitled'}
                    </Text>
                    <Text style={styles.photoInfoText}>
                      Date: {format(parseISO(image.created_at), 'PPpp')}
                    </Text>
                    <Text style={styles.photoInfoText}>
                      Storage: {image.storage_type}
                    </Text>
                    <Text style={styles.photoInfoText}>Type: {image.type}</Text>
                  </LinearGradient>
                )}

                {/* Instagram-style reactions */}
                {showReactions && (
                  <View style={styles.reactionsContainer}>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                    >
                      {REACTIONS.map((emoji, idx) => {
                        const hasReacted = reactions.some(
                          r => r.user_id === userId && r.emoji === emoji,
                        );
                        return (
                          <TouchableOpacity
                            key={idx}
                            onPress={() => toggleReaction(emoji, image)}
                            style={[
                              styles.reactionButton,
                              hasReacted && styles.reactionButtonActive,
                            ]}
                          >
                            <Animated.Text
                              style={[
                                styles.reactionEmoji,
                                {
                                  transform: [
                                    {
                                      scale: hasReacted ? 1.2 : 1,
                                    },
                                  ],
                                },
                              ]}
                            >
                              {emoji}
                            </Animated.Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                )}

                {/* Display reactions */}
                {reactions.length > 0 && (
                  <View style={styles.reactionsDisplay}>
                    <View style={styles.reactionsRow}>
                      {reactions.slice(0, 5).map((r, idx) => (
                        <Text key={idx} style={styles.displayedReaction}>
                          {r.emoji}
                        </Text>
                      ))}
                      {reactions.length > 5 && (
                        <Text style={styles.moreReactions}>
                          +{reactions.length - 5}
                        </Text>
                      )}
                    </View>
                  </View>
                )}

                {/* Footer Actions */}
                <LinearGradient
                  colors={['transparent', 'rgba(0,0,0,0.8)']}
                  style={styles.viewerFooter}
                >
                  <TouchableOpacity
                    style={styles.viewerButton}
                    onPress={() => handleShareItem(image)}
                  >
                    <Icon name="share-social" size={24} color="#FFFFFF" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.viewerButton}
                    onPress={() => handleSaveItem(image)}
                  >
                    <Icon name="download" size={24} color="#FFFFFF" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.viewerButton}
                    onPress={() => handleToggleFavoriteItem(image)}
                  >
                    <Icon
                      name={image.favorite ? 'heart' : 'heart-outline'}
                      size={24}
                      color={image.favorite ? theme.shared.red : '#FFFFFF'}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.viewerButton}
                    onPress={() => setShowReactions(v => !v)}
                  >
                    <Icon name="happy" size={24} color="#FFFFFF" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.viewerButton}
                    onPress={() => handleDeleteItem(image)}
                  >
                    <Icon name="trash" size={24} color={theme.shared.red} />
                  </TouchableOpacity>
                </LinearGradient>
              </View>
            );
          }}
        />

        {/* Seconds modal (like other screens) */}
        <Modal
          isVisible={secondsModalVisible}
          onBackdropPress={() => setSecondsModalVisible(false)}
          onBackButtonPress={() => setSecondsModalVisible(false)}
          backdropOpacity={0.5}
          useNativeDriver
        >
          <View style={styles.secondsModal}>
            <Text style={styles.secondsTitle}>Slideshow interval</Text>
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

        {/* Error Modal */}
        <ErrorModal
          visible={errorModal.visible}
          message={errorModal.message}
          onClose={() => setErrorModal({ visible: false, message: '' })}
          theme={theme}
        />
        {/* Success Modal */}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    justifyContent: 'space-between',
  },
  headerTitleContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 25,
    marginRight: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  subtitle: {
    fontSize: 14,
    color: '#FFFFFF',
    opacity: 0.9,
    marginLeft: 8,
  },
  selectButton: {
    padding: 8,
  },
  multiSelectBar: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  multiSelectGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    padding: 12,
    justifyContent: 'space-between',
    elevation: 2,
  },
  selectedText: {
    fontWeight: 'bold',
    fontSize: 16,
  },
  multiSelectActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  multiSelectButton: {
    padding: 8,
    marginHorizontal: 4,
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderRadius: 20,
  },
  grid: {
    paddingBottom: 20,
    paddingHorizontal: 16,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 60,
  },
  emptyText: {
    fontSize: 20,
    fontWeight: '600',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  viewerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    zIndex: 999,
  },
  viewerHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 50 : 20,
    paddingHorizontal: 20,
    paddingBottom: 20,
    zIndex: 10,
  },
  viewerCloseButton: {
    padding: 8,
  },
  viewerHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  viewerHeaderButton: {
    padding: 8,
    marginLeft: 16,
  },
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
    marginHorizontal: 4,
  },
  durationPicker: {
    position: 'absolute',
    top: 80,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: 12,
    padding: 8,
  },
  durationOption: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginVertical: 2,
  },
  durationOptionActive: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  durationText: {
    color: '#FFFFFF',
    fontSize: 14,
  },
  durationTextActive: {
    fontWeight: 'bold',
  },
  photoInfoPanel: {
    position: 'absolute',
    bottom: 180,
    left: 20,
    right: 20,
    padding: 20,
    borderRadius: 16,
  },
  photoInfoTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  photoInfoText: {
    color: '#FFFFFF',
    fontSize: 14,
    marginVertical: 2,
  },
  reactionsContainer: {
    position: 'absolute',
    bottom: 100,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: 'transparent', // Fully transparent
  },
  reactionButton: {
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  reactionButtonActive: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 20,
  },
  reactionEmoji: {
    fontSize: 30,
  },
  reactionsDisplay: {
    position: 'absolute',
    bottom: 160,
    left: 20,
  },
  reactionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  displayedReaction: {
    fontSize: 20,
    marginRight: 4,
  },
  moreReactions: {
    color: '#FFFFFF',
    fontSize: 14,
    marginLeft: 8,
  },
  // Seconds modal styles
  secondsModal: { backgroundColor: '#222', padding: 16, borderRadius: 16 },
  secondsTitle: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
    marginBottom: 12,
    textAlign: 'center',
  },
  secondsChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  secondsChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#333',
    margin: 4,
  },
  secondsChipActive: { backgroundColor: '#555' },
  secondsChipText: { color: '#eee', fontSize: 13, fontWeight: '600' },
  secondsChipTextActive: { color: '#fff' },
  secondsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  secondsBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#444',
  },
  secondsValue: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 18,
    marginHorizontal: 16,
  },
  secondsActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  secondsActionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    marginHorizontal: 6,
    alignItems: 'center',
  },
  secondsActionText: { color: '#fff', fontWeight: '700' },
});

export default FavoritesScreen;

// // FavoritesScreen.js - Complete with all GalleryScreen features
// import React, { useState, useEffect, useCallback, useRef } from 'react';
// import {
//   View,
//   Text,
//   StyleSheet,
//   FlatList,
//   TouchableOpacity,
//   ActivityIndicator,
//   Platform,
//   ScrollView,
//   Alert,
//   PermissionsAndroid,
//   ToastAndroid,
//   Animated,
//   Dimensions,
//   RefreshControl,
// } from 'react-native';
// import { SafeAreaView } from 'react-native-safe-area-context';
// import { useTheme } from '../theme/ThemeContext';
// import { supabase } from '../services/supabase';
// import PhotoGridItem from '../components/PhotoGridItem';
// import ImageViewing from 'react-native-image-viewing';
// import Share from 'react-native-share';
// import BlobUtil from 'react-native-blob-util';
// import Icon from 'react-native-vector-icons/Ionicons';
// import Modal from 'react-native-modal';
// import ErrorModal from '../components/ErrorModal';
// import LinearGradient from 'react-native-linear-gradient';
// import { format, parseISO } from 'date-fns';
// import { useFocusEffect } from '@react-navigation/native';

// // Constants
// const REACTIONS = ['❤️', '😍', '🔥', '💕', '✨', '😊'];
// const SLIDESHOW_DURATIONS = [
//   { label: '3 sec', value: 3000 },
//   { label: '5 sec', value: 5000 },
//   { label: '10 sec', value: 10000 },
//   { label: '15 sec', value: 15000 },
// ];

// const { width, height } = Dimensions.get('window');

// const FavoritesScreen = ({ navigation }) => {
//   const { theme } = useTheme();
//   const fadeAnim = useRef(new Animated.Value(0)).current;
//   const scaleAnim = useRef(new Animated.Value(0.9)).current;
//   const reactionAnim = useRef(new Animated.Value(0)).current;

//   // Data states
//   const [images, setImages] = useState([]);
//   const [loading, setLoading] = useState(true);
//   const [refreshing, setRefreshing] = useState(false);
//   const [userId, setUserId] = useState('');
//   const [userName, setUserName] = useState('');

//   // Viewer states
//   const [isViewerVisible, setIsViewerVisible] = useState(false);
//   const [currentIndex, setCurrentIndex] = useState(0);
//   const [showPhotoInfo, setShowPhotoInfo] = useState(false);
//   const [slideshowActive, setSlideshowActive] = useState(false);
//   const [slideshowDuration, setSlideshowDuration] = useState(5000);
//   const [showDurationPicker, setShowDurationPicker] = useState(false);

//   // Reactions
//   const [showReactions, setShowReactions] = useState(false);
//   const [imageReactions, setImageReactions] = useState({});

//   // Multi-select
//   const [multiSelect, setMultiSelect] = useState(false);
//   const [selectedIds, setSelectedIds] = useState([]);

//   // Modals
//   const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
//   const [selectedImage, setSelectedImage] = useState(null);
//   const [errorModal, setErrorModal] = useState({ visible: false, message: '' });
//   const [successModal, setSuccessModal] = useState({
//     visible: false,
//     message: '',
//   });

//   // Slideshow timer
//   const slideshowTimer = useRef(null);

//   // Animations
//   useEffect(() => {
//     Animated.parallel([
//       Animated.timing(fadeAnim, {
//         toValue: 1,
//         duration: 1000,
//         useNativeDriver: true,
//       }),
//       Animated.spring(scaleAnim, {
//         toValue: 1,
//         friction: 4,
//         useNativeDriver: true,
//       }),
//     ]).start();
//   }, []);

//   // Debug log for every render
//   console.log('[FavoritesScreen] Render', {
//     loading,
//     imagesCount: images.length,
//     multiSelect,
//     selectedIds: selectedIds.length,
//     slideshowActive,
//     slideshowDuration,
//   });

//   // Get user info
//   useEffect(() => {
//     const getUserInfo = async () => {
//       const {
//         data: { user },
//       } = await supabase.auth.getUser();
//       if (user) {
//         setUserId(user.id);
//         const { data } = await supabase
//           .from('profiles')
//           .select('username')
//           .eq('id', user.id)
//           .maybeSingle();
//         setUserName(data?.username || 'User');
//       }
//     };
//     getUserInfo();
//   }, []);

//   // Fetch favorites from Supabase
//   const fetchFavorites = useCallback(async () => {
//     console.log(
//       '[FavoritesScreen] --- Fetching favorites from Supabase... ---',
//     );
//     setLoading(true);
//     try {
//       const { data, error } = await supabase
//         .from('images')
//         .select('*')
//         .eq('favorite', true)
//         .order('created_at', { ascending: false });

//       if (error) throw error;

//       setImages(data || []);
//       console.log(
//         '[FavoritesScreen] Supabase fetch success. Images:',
//         data?.length,
//       );
//     } catch (error) {
//       console.log('[FavoritesScreen] Fetch error:', error);
//       setErrorModal({ visible: true, message: error.message });
//       setImages([]);
//     } finally {
//       setLoading(false);
//       setRefreshing(false);
//     }
//   }, []);

//   // Fetch reactions
//   const fetchReactions = useCallback(async () => {
//     try {
//       const { data: reactions } = await supabase.from('reactions').select('*');

//       // Group reactions by image_id
//       const reactionsByImage = {};
//       reactions?.forEach(r => {
//         if (!reactionsByImage[r.image_id]) reactionsByImage[r.image_id] = [];
//         reactionsByImage[r.image_id].push(r);
//       });
//       setImageReactions(reactionsByImage);

//       console.log('[FavoritesScreen] Fetched reactions');
//     } catch (e) {
//       console.log('[FavoritesScreen] Error fetching reactions:', e);
//     }
//   }, []);

//   // Initial load and realtime subscription
//   useEffect(() => {
//     fetchFavorites();
//     fetchReactions();

//     const imagesChannel = supabase
//       .channel('public:images:favorites')
//       .on(
//         'postgres_changes',
//         { event: '*', schema: 'public', table: 'images' },
//         payload => {
//           console.log(
//             '[FavoritesScreen] Realtime event received:',
//             payload.eventType,
//           );
//           fetchFavorites();
//         },
//       )
//       .subscribe();

//     const reactionsChannel = supabase
//       .channel('public:reactions:favorites')
//       .on(
//         'postgres_changes',
//         { event: '*', schema: 'public', table: 'reactions' },
//         () => {
//           fetchReactions();
//         },
//       )
//       .subscribe();

//     return () => {
//       supabase.removeChannel(imagesChannel);
//       supabase.removeChannel(reactionsChannel);
//     };
//   }, [fetchFavorites, fetchReactions]);

//   // Focus effect
//   useFocusEffect(
//     useCallback(() => {
//       fetchFavorites();
//       fetchReactions();
//     }, [fetchFavorites, fetchReactions]),
//   );

//   // Pull to refresh
//   const onRefresh = () => {
//     setRefreshing(true);
//     fetchFavorites();
//     fetchReactions();
//   };

//   // Open image viewer
//   const openImage = index => {
//     setCurrentIndex(index);
//     setIsViewerVisible(true);
//     setShowReactions(false);
//     setShowPhotoInfo(false);
//     setShowDurationPicker(false);
//     console.log(
//       '[FavoritesScreen] Opened viewer for image:',
//       images[index]?.id,
//       'at index',
//       index,
//     );
//   };

//   // Delete image
//   const handleDelete = async () => {
//     const image = images[currentIndex];
//     if (!image) return;

//     Alert.alert('Delete', 'Delete this photo?', [
//       { text: 'Cancel', style: 'cancel' },
//       {
//         text: 'Delete',
//         style: 'destructive',
//         onPress: async () => {
//           try {
//             const { error } = await supabase
//               .from('images')
//               .delete()
//               .eq('id', image.id);
//             if (error) throw error;

//             setIsViewerVisible(false);
//             fetchFavorites();
//             console.log('[FavoritesScreen] Deleted image:', image.id);
//           } catch (error) {
//             setErrorModal({ visible: true, message: error.message });
//           }
//         },
//       },
//     ]);
//   };

//   // Share image
//   const handleShare = async () => {
//     try {
//       const image = images[currentIndex];
//       if (!image) return;
//       await Share.open({ url: image.image_url });
//       console.log('[FavoritesScreen] Shared image:', image.image_url);
//     } catch (e) {
//       if (e?.message !== 'User did not share') {
//         setErrorModal({ visible: true, message: e.message });
//       }
//     }
//   };

//   // Save image with proper permissions
//   const handleSave = async () => {
//     try {
//       const image = images[currentIndex];
//       if (!image) return;

//       // Request permissions for Android
//       if (Platform.OS === 'android') {
//         try {
//           const androidVersion = Platform.Version;

//           if (androidVersion >= 33) {
//             // Android 13+
//             const granted = await PermissionsAndroid.requestMultiple([
//               PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
//               PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO,
//             ]);

//             const allGranted = Object.values(granted).every(
//               p => p === PermissionsAndroid.RESULTS.GRANTED,
//             );

//             if (!allGranted) {
//               setErrorModal({
//                 visible: true,
//                 message: 'Storage permission required',
//               });
//               return;
//             }
//           } else {
//             // Android 12 and below
//             const granted = await PermissionsAndroid.request(
//               PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
//               {
//                 title: 'Storage Permission Required',
//                 message: 'This app needs access to your storage to save photos',
//                 buttonNeutral: 'Ask Me Later',
//                 buttonNegative: 'Cancel',
//                 buttonPositive: 'OK',
//               },
//             );

//             if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
//               setErrorModal({
//                 visible: true,
//                 message: 'Storage permission required',
//               });
//               return;
//             }
//           }
//         } catch (err) {
//           console.warn('Permission error:', err);
//         }
//       }

//       const fileUrl = image.image_url;
//       const fileName =
//         image.file_name ||
//         fileUrl.split('/').pop() ||
//         `image_${Date.now()}.jpg`;
//       const dirs = BlobUtil.fs.dirs;

//       const dest =
//         Platform.OS === 'android'
//           ? `${dirs.PictureDir}/Favorites/${fileName}`
//           : `${dirs.DocumentDir}/${fileName}`;

//       console.log('[FavoritesScreen] Saving file to device...', {
//         dest,
//         fileUrl,
//       });

//       if (Platform.OS === 'android') {
//         const configOptions = {
//           fileCache: true,
//           addAndroidDownloads: {
//             useDownloadManager: true,
//             notification: true,
//             mediaScannable: true,
//             title: fileName,
//             path: dest,
//             description: 'Downloading image...',
//           },
//         };

//         await BlobUtil.config(configOptions).fetch('GET', fileUrl);
//         ToastAndroid.show(
//           `Saved to Pictures/Favorites/${fileName}`,
//           ToastAndroid.LONG,
//         );
//       } else {
//         await BlobUtil.config({ path: dest }).fetch('GET', fileUrl);
//       }

//       setSuccessModal({ visible: true, message: 'Image saved successfully!' });
//       console.log('[FavoritesScreen] Saved file to:', dest);
//     } catch (e) {
//       console.log('[FavoritesScreen] Save error:', e);
//       setErrorModal({ visible: true, message: 'Failed to save: ' + e.message });
//     }
//   };

//   // Toggle favorite (unfavorite)
//   const handleToggleFavorite = async () => {
//     const image = images[currentIndex];
//     if (!image) return;

//     try {
//       const updated = !image.favorite;
//       await supabase
//         .from('images')
//         .update({ favorite: updated })
//         .eq('id', image.id);

//       if (!updated) {
//         // If unfavorited, remove from list
//         setImages(prev => prev.filter(img => img.id !== image.id));
//         setIsViewerVisible(false);
//       } else {
//         setImages(prev =>
//           prev.map(img =>
//             img.id === image.id ? { ...img, favorite: updated } : img,
//           ),
//         );
//       }

//       console.log(
//         '[FavoritesScreen] Toggled favorite for image:',
//         image.id,
//         'Now:',
//         updated,
//       );
//     } catch (e) {
//       setErrorModal({ visible: true, message: e.message });
//     }
//   };

//   // Toggle reaction (Instagram-style)
//   const toggleReaction = async emoji => {
//     const img = images[currentIndex];
//     if (!img) return;

//     try {
//       // Check if user already reacted with this emoji
//       const existingReactions = imageReactions[img.id] || [];
//       const userReaction = existingReactions.find(
//         r => r.user_id === userId && r.emoji === emoji,
//       );

//       if (userReaction) {
//         // Remove reaction if already exists
//         console.log('[FavoritesScreen] Removing reaction:', emoji);
//         const { error } = await supabase
//           .from('reactions')
//           .delete()
//           .match({ image_id: img.id, user_id: userId, emoji });

//         if (error) throw error;

//         // Update local state
//         setImageReactions(prev => ({
//           ...prev,
//           [img.id]: prev[img.id].filter(
//             r => !(r.user_id === userId && r.emoji === emoji),
//           ),
//         }));
//       } else {
//         // Add new reaction
//         console.log('[FavoritesScreen] Adding reaction:', emoji);
//         Animated.sequence([
//           Animated.timing(reactionAnim, {
//             toValue: 1,
//             duration: 300,
//             useNativeDriver: true,
//           }),
//           Animated.timing(reactionAnim, {
//             toValue: 0,
//             duration: 200,
//             useNativeDriver: true,
//           }),
//         ]).start();

//         const { error } = await supabase.from('reactions').insert({
//           image_id: img.id,
//           user_id: userId,
//           emoji,
//           created_at: new Date().toISOString(),
//         });

//         if (error) throw error;

//         // Update local state
//         setImageReactions(prev => ({
//           ...prev,
//           [img.id]: [...(prev[img.id] || []), { user_id: userId, emoji }],
//         }));
//       }
//     } catch (e) {
//       console.log('[FavoritesScreen] Error toggling reaction:', e);
//       setErrorModal({ visible: true, message: 'Failed to update reaction' });
//     }
//   };

//   // Slideshow functions
//   const toggleSlideshow = () => {
//     if (slideshowActive) {
//       clearInterval(slideshowTimer.current);
//       setSlideshowActive(false);
//       console.log('[FavoritesScreen] Slideshow stopped');
//     } else {
//       setSlideshowActive(true);
//       slideshowTimer.current = setInterval(() => {
//         setCurrentIndex(prev => {
//           const next = (prev + 1) % images.length;
//           console.log('[FavoritesScreen] Slideshow next:', next);
//           return next;
//         });
//       }, slideshowDuration);
//       console.log(
//         '[FavoritesScreen] Slideshow started with duration:',
//         slideshowDuration,
//       );
//     }
//   };

//   // Update slideshow when duration changes
//   useEffect(() => {
//     if (slideshowActive) {
//       clearInterval(slideshowTimer.current);
//       slideshowTimer.current = setInterval(() => {
//         setCurrentIndex(prev => (prev + 1) % images.length);
//       }, slideshowDuration);
//       console.log(
//         '[FavoritesScreen] Slideshow duration updated to:',
//         slideshowDuration,
//       );
//     }
//   }, [slideshowDuration, slideshowActive, images.length]);

//   // Cleanup slideshow on unmount
//   useEffect(() => {
//     return () => {
//       if (slideshowTimer.current) {
//         clearInterval(slideshowTimer.current);
//       }
//     };
//   }, []);

//   // Multi-select functions
//   const toggleSelect = id => {
//     setSelectedIds(prev =>
//       prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id],
//     );
//   };

//   const startMultiSelect = id => {
//     if (!multiSelect) setMultiSelect(true);
//     toggleSelect(id);
//   };

//   const handleBatchDelete = async () => {
//     if (!selectedIds.length) return;
//     Alert.alert('Delete', `Delete ${selectedIds.length} item(s)?`, [
//       { text: 'Cancel', style: 'cancel' },
//       {
//         text: 'Delete',
//         style: 'destructive',
//         onPress: async () => {
//           await supabase.from('images').delete().in('id', selectedIds);
//           setSelectedIds([]);
//           setMultiSelect(false);
//           fetchFavorites();
//         },
//       },
//     ]);
//   };

//   const handleBatchShare = async () => {
//     if (!selectedIds.length) return;
//     const urls = images
//       .filter(i => selectedIds.includes(i.id))
//       .map(i => i.image_url);
//     try {
//       await Share.open({ urls });
//     } catch (e) {
//       console.log('[FavoritesScreen] Batch share error:', e);
//     }
//   };

//   const handleBatchUnfavorite = async () => {
//     if (!selectedIds.length) return;
//     try {
//       await supabase
//         .from('images')
//         .update({ favorite: false })
//         .in('id', selectedIds);
//       setSelectedIds([]);
//       setMultiSelect(false);
//       fetchFavorites();
//     } catch (e) {
//       setErrorModal({ visible: true, message: e.message });
//     }
//   };

//   // Render each image in grid
//   const renderItem = ({ item, index }) => (
//     <PhotoGridItem
//       image={item}
//       onPress={() => (multiSelect ? toggleSelect(item.id) : openImage(index))}
//       onLongPress={() => startMultiSelect(item.id)}
//       selected={selectedIds.includes(item.id)}
//       showSelect={multiSelect}
//     />
//   );

//   // Loading state
//   if (loading) {
//     return (
//       <LinearGradient colors={theme.gradient} style={styles.loader}>
//         <ActivityIndicator size="large" color="#FFFFFF" />
//         <Text style={styles.loadingText}>Loading your favorites...</Text>
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
//               transform: [{ scale: scaleAnim }],
//             },
//           ]}
//         >
//           <LinearGradient
//             colors={theme.gradient}
//             start={{ x: 0, y: 0 }}
//             end={{ x: 1, y: 0 }}
//             style={styles.headerTitleContainer}
//           >
//             <Icon
//               name="heart"
//               size={24}
//               color="#FFFFFF"
//               style={{ marginRight: 8 }}
//             />
//             <Text style={styles.title}>Favorites</Text>
//             <Text style={styles.subtitle}>{images.length} memories</Text>
//           </LinearGradient>

//           {images.length > 0 && (
//             <TouchableOpacity
//               onPress={() => setMultiSelect(v => !v)}
//               style={styles.selectButton}
//             >
//               <Icon
//                 name={multiSelect ? 'checkbox' : 'checkbox-outline'}
//                 size={28}
//                 color={theme.colors.primary}
//               />
//             </TouchableOpacity>
//           )}
//         </Animated.View>

//         {/* Multi-select bar */}
//         {multiSelect && (
//           <Animated.View style={[styles.multiSelectBar, { opacity: fadeAnim }]}>
//             <LinearGradient
//               colors={[
//                 theme.colors.primary + '20',
//                 theme.colors.secondary + '10',
//               ]}
//               style={styles.multiSelectGradient}
//             >
//               <Text
//                 style={[styles.selectedText, { color: theme.colors.primary }]}
//               >
//                 {selectedIds.length} selected
//               </Text>
//               <View style={styles.multiSelectActions}>
//                 <TouchableOpacity
//                   onPress={handleBatchShare}
//                   style={styles.multiSelectButton}
//                 >
//                   <Icon
//                     name="share-social"
//                     size={22}
//                     color={theme.colors.accent}
//                   />
//                 </TouchableOpacity>
//                 <TouchableOpacity
//                   onPress={handleBatchUnfavorite}
//                   style={styles.multiSelectButton}
//                 >
//                   <Icon
//                     name="heart-dislike"
//                     size={22}
//                     color={theme.shared.orange}
//                   />
//                 </TouchableOpacity>
//                 <TouchableOpacity
//                   onPress={handleBatchDelete}
//                   style={styles.multiSelectButton}
//                 >
//                   <Icon name="trash" size={22} color={theme.shared.red} />
//                 </TouchableOpacity>
//                 <TouchableOpacity
//                   onPress={() => setSelectedIds(images.map(i => i.id))}
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

//         {/* Content */}
//         {images.length === 0 ? (
//           <View style={styles.emptyState}>
//             <Icon name="heart-outline" size={80} color={theme.colors.primary} />
//             <Text style={[styles.emptyText, { color: theme.gray.medium }]}>
//               No favorites yet!
//             </Text>
//             <Text style={[styles.emptySubtext, { color: theme.gray.light }]}>
//               Tap the heart icon on photos to add them here
//             </Text>
//           </View>
//         ) : (
//           <FlatList
//             data={images}
//             numColumns={2}
//             keyExtractor={item => item.id.toString()}
//             contentContainerStyle={styles.grid}
//             renderItem={renderItem}
//             refreshControl={
//               <RefreshControl
//                 refreshing={refreshing}
//                 onRefresh={onRefresh}
//                 tintColor={theme.colors.primary}
//                 colors={[theme.colors.primary]}
//               />
//             }
//           />
//         )}

//         {/* Enhanced Image Viewer */}
//         <ImageViewing
//           images={images.map(img => ({ uri: img.image_url }))}
//           imageIndex={currentIndex}
//           visible={isViewerVisible}
//           onRequestClose={() => {
//             setIsViewerVisible(false);
//             if (slideshowActive) toggleSlideshow();
//           }}
//           doubleTapToZoomEnabled
//           swipeToCloseEnabled
//           onImageIndexChange={idx => {
//             setCurrentIndex(idx);
//             setShowReactions(false);
//             setShowPhotoInfo(false);
//             setShowDurationPicker(false);
//           }}
//           HeaderComponent={() => (
//             <LinearGradient
//               colors={['rgba(0,0,0,0.7)', 'transparent']}
//               style={styles.viewerHeader}
//             >
//               <TouchableOpacity
//                 onPress={() => {
//                   setIsViewerVisible(false);
//                   if (slideshowActive) toggleSlideshow();
//                 }}
//                 style={styles.viewerCloseButton}
//               >
//                 <Icon name="close" size={28} color="#FFFFFF" />
//               </TouchableOpacity>
//               <View style={styles.viewerHeaderActions}>
//                 <TouchableOpacity
//                   onPress={() => setShowDurationPicker(v => !v)}
//                   style={styles.viewerHeaderButton}
//                 >
//                   <Icon name="time" size={24} color="#FFFFFF" />
//                 </TouchableOpacity>
//                 <TouchableOpacity
//                   onPress={toggleSlideshow}
//                   style={styles.viewerHeaderButton}
//                 >
//                   <Icon
//                     name={slideshowActive ? 'pause' : 'play'}
//                     size={24}
//                     color="#FFFFFF"
//                   />
//                 </TouchableOpacity>
//                 <TouchableOpacity
//                   onPress={() => setShowPhotoInfo(v => !v)}
//                   style={styles.viewerHeaderButton}
//                 >
//                   <Icon name="information-circle" size={24} color="#FFFFFF" />
//                 </TouchableOpacity>
//               </View>
//             </LinearGradient>
//           )}
//           FooterComponent={() => {
//             const image = images[currentIndex];
//             if (!image) return null;
//             const reactions = imageReactions[image.id] || [];

//             return (
//               <View>
//                 {/* Slideshow Duration Picker */}
//                 {showDurationPicker && (
//                   <View style={styles.durationPicker}>
//                     {SLIDESHOW_DURATIONS.map(duration => (
//                       <TouchableOpacity
//                         key={duration.value}
//                         onPress={() => {
//                           setSlideshowDuration(duration.value);
//                           setShowDurationPicker(false);
//                           console.log(
//                             '[FavoritesScreen] Duration set to:',
//                             duration.label,
//                           );
//                         }}
//                         style={[
//                           styles.durationOption,
//                           slideshowDuration === duration.value &&
//                             styles.durationOptionActive,
//                         ]}
//                       >
//                         <Text
//                           style={[
//                             styles.durationText,
//                             slideshowDuration === duration.value &&
//                               styles.durationTextActive,
//                           ]}
//                         >
//                           {duration.label}
//                         </Text>
//                       </TouchableOpacity>
//                     ))}
//                   </View>
//                 )}

//                 {/* Photo Info Panel */}
//                 {showPhotoInfo && (
//                   <LinearGradient
//                     colors={['transparent', 'rgba(0,0,0,0.9)']}
//                     style={styles.photoInfoPanel}
//                   >
//                     <Text style={styles.photoInfoTitle}>Photo Details</Text>
//                     <Text style={styles.photoInfoText}>
//                       Name: {image.file_name || 'Untitled'}
//                     </Text>
//                     <Text style={styles.photoInfoText}>
//                       Date: {format(parseISO(image.created_at), 'PPpp')}
//                     </Text>
//                     <Text style={styles.photoInfoText}>
//                       Storage: {image.storage_type}
//                     </Text>
//                     <Text style={styles.photoInfoText}>Type: {image.type}</Text>
//                   </LinearGradient>
//                 )}

//                 {/* Instagram-style reactions */}
//                 {showReactions && (
//                   <View style={styles.reactionsContainer}>
//                     <ScrollView
//                       horizontal
//                       showsHorizontalScrollIndicator={false}
//                     >
//                       {REACTIONS.map((emoji, idx) => {
//                         const hasReacted = reactions.some(
//                           r => r.user_id === userId && r.emoji === emoji,
//                         );
//                         return (
//                           <TouchableOpacity
//                             key={idx}
//                             onPress={() => toggleReaction(emoji)}
//                             style={[
//                               styles.reactionButton,
//                               hasReacted && styles.reactionButtonActive,
//                             ]}
//                           >
//                             <Animated.Text
//                               style={[
//                                 styles.reactionEmoji,
//                                 {
//                                   transform: [
//                                     {
//                                       scale: hasReacted ? 1.2 : 1,
//                                     },
//                                   ],
//                                 },
//                               ]}
//                             >
//                               {emoji}
//                             </Animated.Text>
//                           </TouchableOpacity>
//                         );
//                       })}
//                     </ScrollView>
//                   </View>
//                 )}

//                 {/* Display reactions */}
//                 {reactions.length > 0 && (
//                   <View style={styles.reactionsDisplay}>
//                     <View style={styles.reactionsRow}>
//                       {reactions.slice(0, 5).map((r, idx) => (
//                         <Text key={idx} style={styles.displayedReaction}>
//                           {r.emoji}
//                         </Text>
//                       ))}
//                       {reactions.length > 5 && (
//                         <Text style={styles.moreReactions}>
//                           +{reactions.length - 5}
//                         </Text>
//                       )}
//                     </View>
//                   </View>
//                 )}

//                 {/* Footer Actions */}
//                 <LinearGradient
//                   colors={['transparent', 'rgba(0,0,0,0.8)']}
//                   style={styles.viewerFooter}
//                 >
//                   <TouchableOpacity
//                     style={styles.viewerButton}
//                     onPress={handleShare}
//                   >
//                     <Icon name="share-social" size={24} color="#FFFFFF" />
//                   </TouchableOpacity>
//                   <TouchableOpacity
//                     style={styles.viewerButton}
//                     onPress={handleSave}
//                   >
//                     <Icon name="download" size={24} color="#FFFFFF" />
//                   </TouchableOpacity>
//                   <TouchableOpacity
//                     style={styles.viewerButton}
//                     onPress={handleToggleFavorite}
//                   >
//                     <Icon
//                       name={image.favorite ? 'heart' : 'heart-outline'}
//                       size={24}
//                       color={image.favorite ? theme.shared.red : '#FFFFFF'}
//                     />
//                   </TouchableOpacity>
//                   <TouchableOpacity
//                     style={styles.viewerButton}
//                     onPress={() => setShowReactions(v => !v)}
//                   >
//                     <Icon name="happy" size={24} color="#FFFFFF" />
//                   </TouchableOpacity>
//                   <TouchableOpacity
//                     style={styles.viewerButton}
//                     onPress={handleDelete}
//                   >
//                     <Icon name="trash" size={24} color={theme.shared.red} />
//                   </TouchableOpacity>
//                 </LinearGradient>
//               </View>
//             );
//           }}
//         />

//         {/* Error Modal */}
//         <ErrorModal
//           visible={errorModal.visible}
//           message={errorModal.message}
//           onClose={() => setErrorModal({ visible: false, message: '' })}
//           theme={theme}
//         />
//         {/* Success Modal */}
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
//   loader: {
//     flex: 1,
//     justifyContent: 'center',
//     alignItems: 'center',
//   },
//   loadingText: {
//     color: '#FFFFFF',
//     fontSize: 18,
//     marginTop: 16,
//     fontWeight: '600',
//   },
//   header: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     paddingHorizontal: 16,
//     paddingTop: 8,
//     paddingBottom: 16,
//     justifyContent: 'space-between',
//   },
//   headerTitleContainer: {
//     flex: 1,
//     flexDirection: 'row',
//     alignItems: 'center',
//     justifyContent: 'center',
//     paddingVertical: 12,
//     paddingHorizontal: 20,
//     borderRadius: 25,
//     marginRight: 12,
//   },
//   title: {
//     fontSize: 22,
//     fontWeight: 'bold',
//     color: '#FFFFFF',
//   },
//   subtitle: {
//     fontSize: 14,
//     color: '#FFFFFF',
//     opacity: 0.9,
//     marginLeft: 8,
//   },
//   selectButton: {
//     padding: 8,
//   },
//   multiSelectBar: {
//     marginHorizontal: 16,
//     marginBottom: 12,
//   },
//   multiSelectGradient: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     borderRadius: 20,
//     padding: 12,
//     justifyContent: 'space-between',
//     elevation: 2,
//   },
//   selectedText: {
//     fontWeight: 'bold',
//     fontSize: 16,
//   },
//   multiSelectActions: {
//     flexDirection: 'row',
//     alignItems: 'center',
//   },
//   multiSelectButton: {
//     padding: 8,
//     marginHorizontal: 4,
//     backgroundColor: 'rgba(255,255,255,0.8)',
//     borderRadius: 20,
//   },
//   grid: {
//     paddingBottom: 20,
//     paddingHorizontal: 16,
//   },
//   emptyState: {
//     flex: 1,
//     alignItems: 'center',
//     justifyContent: 'center',
//     marginTop: 60,
//   },
//   emptyText: {
//     fontSize: 20,
//     fontWeight: '600',
//     marginTop: 16,
//   },
//   emptySubtext: {
//     fontSize: 14,
//     marginTop: 8,
//     textAlign: 'center',
//   },
//   viewerHeader: {
//     position: 'absolute',
//     top: 0,
//     left: 0,
//     right: 0,
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     alignItems: 'center',
//     paddingTop: Platform.OS === 'ios' ? 50 : 20,
//     paddingHorizontal: 20,
//     paddingBottom: 20,
//     zIndex: 10,
//   },
//   viewerCloseButton: {
//     padding: 8,
//   },
//   viewerHeaderActions: {
//     flexDirection: 'row',
//     alignItems: 'center',
//   },
//   viewerHeaderButton: {
//     padding: 8,
//     marginLeft: 16,
//   },
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
//     marginHorizontal: 4,
//   },
//   durationPicker: {
//     position: 'absolute',
//     top: 80,
//     right: 20,
//     backgroundColor: 'rgba(0,0,0,0.8)',
//     borderRadius: 12,
//     padding: 8,
//   },
//   durationOption: {
//     paddingVertical: 8,
//     paddingHorizontal: 16,
//     borderRadius: 8,
//     marginVertical: 2,
//   },
//   durationOptionActive: {
//     backgroundColor: 'rgba(255,255,255,0.2)',
//   },
//   durationText: {
//     color: '#FFFFFF',
//     fontSize: 14,
//   },
//   durationTextActive: {
//     fontWeight: 'bold',
//   },
//   photoInfoPanel: {
//     position: 'absolute',
//     bottom: 180,
//     left: 20,
//     right: 20,
//     padding: 20,
//     borderRadius: 16,
//   },
//   photoInfoTitle: {
//     color: '#FFFFFF',
//     fontSize: 18,
//     fontWeight: 'bold',
//     marginBottom: 12,
//   },
//   photoInfoText: {
//     color: '#FFFFFF',
//     fontSize: 14,
//     marginVertical: 2,
//   },
//   reactionsContainer: {
//     position: 'absolute',
//     bottom: 100,
//     left: 0,
//     right: 0,
//     paddingHorizontal: 20,
//     paddingVertical: 10,
//     backgroundColor: 'transparent', // Fully transparent
//   },
//   reactionButton: {
//     paddingHorizontal: 15,
//     paddingVertical: 10,
//   },
//   reactionButtonActive: {
//     backgroundColor: 'rgba(255,255,255,0.2)',
//     borderRadius: 20,
//   },
//   reactionEmoji: {
//     fontSize: 30,
//   },
//   reactionsDisplay: {
//     position: 'absolute',
//     bottom: 160,
//     left: 20,
//   },
//   reactionsRow: {
//     flexDirection: 'row',
//     alignItems: 'center',
//   },
//   displayedReaction: {
//     fontSize: 20,
//     marginRight: 4,
//   },
//   moreReactions: {
//     color: '#FFFFFF',
//     fontSize: 14,
//     marginLeft: 8,
//   },
// });

// export default FavoritesScreen;
