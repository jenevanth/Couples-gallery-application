// DayGalleryScreen.js - Complete with all GalleryScreen features
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Animated,
  ScrollView,
  PermissionsAndroid,
  ToastAndroid,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PhotoGridItem from '../components/PhotoGridItem';
import { useTheme } from '../theme/ThemeContext';
import Icon from 'react-native-vector-icons/Ionicons';
import ImageViewing from 'react-native-image-viewing';
import Share from 'react-native-share';
import BlobUtil from 'react-native-blob-util';
import { supabase } from '../services/supabase';
import Modal from 'react-native-modal';
import ErrorModal from '../components/ErrorModal';
import LinearGradient from 'react-native-linear-gradient';
import { format, parseISO } from 'date-fns';

const REACTIONS = ['❤️', '😍', '🔥', '💕', '✨', '😊'];
const SLIDESHOW_DURATIONS = [
  { label: '3 sec', value: 3000 },
  { label: '5 sec', value: 5000 },
  { label: '10 sec', value: 10000 },
  { label: '15 sec', value: 15000 },
];

const DayGalleryScreen = ({ route, navigation }) => {
  const { theme } = useTheme();
  const { date, images: initialImages } = route.params;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const reactionAnim = useRef(new Animated.Value(0)).current;

  const [images, setImages] = useState(initialImages || []);
  const [isViewerVisible, setIsViewerVisible] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [errorModal, setErrorModal] = useState({ visible: false, message: '' });
  const [successModal, setSuccessModal] = useState({
    visible: false,
    message: '',
  });
  const [loading, setLoading] = useState(false);

  // New states from GalleryScreen
  const [showPhotoInfo, setShowPhotoInfo] = useState(false);
  const [slideshowActive, setSlideshowActive] = useState(false);
  const [slideshowDuration, setSlideshowDuration] = useState(5000);
  const [showDurationPicker, setShowDurationPicker] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const [imageReactions, setImageReactions] = useState({});
  const [userId, setUserId] = useState('');
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);

  const slideshowTimer = useRef(null);
  const photosOnly = images.filter(i => i.type !== 'video');

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

  // Get user ID
  useEffect(() => {
    const getUserId = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) setUserId(user.id);
    };
    getUserId();
  }, []);

  // Fetch reactions
  useEffect(() => {
    const fetchReactions = async () => {
      const { data } = await supabase
        .from('reactions')
        .select('*')
        .in(
          'image_id',
          images.map(i => i.id),
        );

      const reactionsByImage = {};
      data?.forEach(r => {
        if (!reactionsByImage[r.image_id]) reactionsByImage[r.image_id] = [];
        reactionsByImage[r.image_id].push(r);
      });
      setImageReactions(reactionsByImage);
    };

    fetchReactions();
  }, [images]);

  // Open image viewer
  const openImage = index => {
    setCurrentIndex(index);
    setIsViewerVisible(true);
    setShowReactions(false);
    setShowPhotoInfo(false);
    console.log(
      '[DayGalleryScreen] Opened viewer for image:',
      images[index]?.id,
    );
  };

  // Toggle slideshow
  const toggleSlideshow = () => {
    if (slideshowActive) {
      clearInterval(slideshowTimer.current);
      setSlideshowActive(false);
    } else {
      setSlideshowActive(true);
      slideshowTimer.current = setInterval(() => {
        setCurrentIndex(prev => {
          const next = (prev + 1) % photosOnly.length;
          return next;
        });
      }, slideshowDuration);
    }
  };

  // Update slideshow when duration changes
  useEffect(() => {
    if (slideshowActive) {
      clearInterval(slideshowTimer.current);
      slideshowTimer.current = setInterval(() => {
        setCurrentIndex(prev => (prev + 1) % photosOnly.length);
      }, slideshowDuration);
    }
  }, [slideshowDuration, slideshowActive, photosOnly.length]);

  // Cleanup slideshow
  useEffect(() => {
    return () => {
      if (slideshowTimer.current) clearInterval(slideshowTimer.current);
    };
  }, []);

  // Delete image
  const handleDelete = async () => {
    const image = photosOnly[currentIndex];
    if (!image) return;

    Alert.alert('Delete', 'Delete this photo?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase
            .from('images')
            .delete()
            .eq('id', image.id);
          if (error) {
            setErrorModal({ visible: true, message: error.message });
          } else {
            setImages(images.filter(img => img.id !== image.id));
            setIsViewerVisible(false);
          }
        },
      },
    ]);
  };

  // Share image
  const handleShare = async () => {
    try {
      const image = photosOnly[currentIndex];
      if (!image) return;
      await Share.open({ url: image.image_url });
    } catch (e) {
      if (e?.message !== 'User did not share') {
        setErrorModal({ visible: true, message: e.message });
      }
    }
  };

  // Save image with proper permissions
  const handleSave = async () => {
    try {
      const image = photosOnly[currentIndex];
      if (!image) return;

      // Request permissions for Android
      if (Platform.OS === 'android') {
        const androidVersion = Platform.Version;

        if (androidVersion >= 33) {
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
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
          );

          if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
            setErrorModal({
              visible: true,
              message: 'Storage permission required',
            });
            return;
          }
        }
      }

      const fileUrl = image.image_url;
      const fileName = image.file_name || `image_${Date.now()}.jpg`;
      const dirs = BlobUtil.fs.dirs;

      const dest =
        Platform.OS === 'android'
          ? `${dirs.PictureDir}/Gallery/${fileName}`
          : `${dirs.DocumentDir}/${fileName}`;

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
          `Saved to Pictures/Gallery/${fileName}`,
          ToastAndroid.LONG,
        );
      } else {
        await BlobUtil.config({ path: dest }).fetch('GET', fileUrl);
      }

      setSuccessModal({ visible: true, message: 'Image saved successfully!' });
    } catch (e) {
      setErrorModal({ visible: true, message: 'Failed to save: ' + e.message });
    }
  };

  // Toggle favorite
  const handleToggleFavorite = async () => {
    const image = photosOnly[currentIndex];
    if (!image) return;

    try {
      const updated = !image.favorite;
      await supabase
        .from('images')
        .update({ favorite: updated })
        .eq('id', image.id);
      setImages(prev =>
        prev.map(img =>
          img.id === image.id ? { ...img, favorite: updated } : img,
        ),
      );
    } catch (e) {
      setErrorModal({ visible: true, message: e.message });
    }
  };

  // Toggle reaction (Instagram-style)
  const toggleReaction = async emoji => {
    const img = photosOnly[currentIndex];
    if (!img) return;

    try {
      const existingReactions = imageReactions[img.id] || [];
      const userReaction = existingReactions.find(
        r => r.user_id === userId && r.emoji === emoji,
      );

      if (userReaction) {
        // Remove reaction
        const { error } = await supabase
          .from('reactions')
          .delete()
          .match({ image_id: img.id, user_id: userId, emoji });

        if (error) throw error;

        setImageReactions(prev => ({
          ...prev,
          [img.id]: prev[img.id].filter(
            r => !(r.user_id === userId && r.emoji === emoji),
          ),
        }));
      } else {
        // Add reaction
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
          image_id: img.id,
          user_id: userId,
          emoji,
        });

        if (error) throw error;

        setImageReactions(prev => ({
          ...prev,
          [img.id]: [...(prev[img.id] || []), { user_id: userId, emoji }],
        }));
      }
    } catch (e) {
      setErrorModal({ visible: true, message: 'Failed to update reaction' });
    }
  };

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
          setImages(prev => prev.filter(i => !selectedIds.includes(i.id)));
          setSelectedIds([]);
          setMultiSelect(false);
        },
      },
    ]);
  };

  const renderItem = ({ item, index }) => (
    <PhotoGridItem
      image={item}
      onPress={() => (multiSelect ? toggleSelect(item.id) : openImage(index))}
      onLongPress={() => startMultiSelect(item.id)}
      selected={selectedIds.includes(item.id)}
      showSelect={multiSelect}
    />
  );

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
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          >
            <LinearGradient
              colors={theme.gradient}
              style={styles.backButtonGradient}
            >
              <Icon name="arrow-back" size={24} color="#FFFFFF" />
            </LinearGradient>
          </TouchableOpacity>

          <LinearGradient colors={theme.gradient} style={styles.titleContainer}>
            <Text style={styles.title}>
              {format(parseISO(date), 'MMMM d, yyyy')}
            </Text>
            <Text style={styles.subtitle}>{images.length} memories</Text>
          </LinearGradient>

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
        </Animated.View>

        {/* Multi-select bar */}
        {multiSelect && (
          <Animated.View style={[styles.multiSelectBar, { opacity: fadeAnim }]}>
            <Text
              style={[styles.selectedText, { color: theme.colors.primary }]}
            >
              {selectedIds.length} selected
            </Text>
            <View style={styles.multiSelectActions}>
              <TouchableOpacity
                onPress={async () => {
                  const urls = images
                    .filter(i => selectedIds.includes(i.id))
                    .map(i => i.image_url);
                  try {
                    await Share.open({ urls });
                  } catch (e) {}
                }}
                style={styles.multiButton}
              >
                <Icon
                  name="share-social"
                  size={22}
                  color={theme.colors.accent}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleBatchDelete}
                style={styles.multiButton}
              >
                <Icon name="trash" size={22} color={theme.shared.red} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setSelectedIds(images.map(i => i.id));
                }}
                style={styles.multiButton}
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
                style={styles.multiButton}
              >
                <Icon name="close-circle" size={22} color={theme.gray.dark} />
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}

        {loading ? (
          <ActivityIndicator size="large" color={theme.colors.primary} />
        ) : (
          <FlatList
            data={images}
            numColumns={2}
            keyExtractor={item => item.id.toString()}
            contentContainerStyle={styles.grid}
            renderItem={renderItem}
          />
        )}

        {/* Enhanced Image Viewer */}
        <ImageViewing
          images={photosOnly.map(img => ({ uri: img.image_url }))}
          imageIndex={currentIndex}
          visible={isViewerVisible}
          onRequestClose={() => {
            setIsViewerVisible(false);
            if (slideshowActive) toggleSlideshow();
          }}
          doubleTapToZoomEnabled
          swipeToCloseEnabled
          onImageIndexChange={idx => {
            setCurrentIndex(idx);
            setShowReactions(false);
            setShowPhotoInfo(false);
          }}
          HeaderComponent={() => (
            <LinearGradient
              colors={['rgba(0,0,0,0.7)', 'transparent']}
              style={styles.viewerHeader}
            >
              <TouchableOpacity
                onPress={() => {
                  setIsViewerVisible(false);
                  if (slideshowActive) toggleSlideshow();
                }}
                style={styles.viewerCloseButton}
              >
                <Icon name="close" size={28} color="#FFFFFF" />
              </TouchableOpacity>
              <View style={styles.viewerHeaderActions}>
                <TouchableOpacity
                  onPress={() => setShowDurationPicker(v => !v)}
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
          FooterComponent={() => {
            const img = photosOnly[currentIndex];
            if (!img) return null;
            const reactions = imageReactions[img.id] || [];

            return (
              <View>
                {/* Slideshow Duration Picker */}
                {showDurationPicker && (
                  <View style={styles.durationPicker}>
                    {SLIDESHOW_DURATIONS.map(duration => (
                      <TouchableOpacity
                        key={duration.value}
                        onPress={() => {
                          setSlideshowDuration(duration.value);
                          setShowDurationPicker(false);
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

                {/* Photo Info */}
                {showPhotoInfo && (
                  <LinearGradient
                    colors={['transparent', 'rgba(0,0,0,0.9)']}
                    style={styles.photoInfoPanel}
                  >
                    <Text style={styles.photoInfoTitle}>Photo Details</Text>
                    <Text style={styles.photoInfoText}>
                      Name: {img.file_name || 'Untitled'}
                    </Text>
                    <Text style={styles.photoInfoText}>
                      Date: {format(parseISO(img.created_at), 'PPpp')}
                    </Text>
                    <Text style={styles.photoInfoText}>
                      Storage: {img.storage_type}
                    </Text>
                  </LinearGradient>
                )}

                {/* Reactions */}
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
                            onPress={() => toggleReaction(emoji)}
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
                    onPress={handleShare}
                  >
                    <Icon name="share-social" size={24} color="#FFFFFF" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.viewerButton}
                    onPress={handleSave}
                  >
                    <Icon name="download" size={24} color="#FFFFFF" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.viewerButton}
                    onPress={handleToggleFavorite}
                  >
                    <Icon
                      name={img.favorite ? 'heart' : 'heart-outline'}
                      size={24}
                      color={img.favorite ? theme.shared.red : '#FFFFFF'}
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
                    onPress={handleDelete}
                  >
                    <Icon name="trash" size={24} color={theme.shared.red} />
                  </TouchableOpacity>
                </LinearGradient>
              </View>
            );
          }}
        />

        {/* Modals */}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 8,
  },
  backButton: {
    marginRight: 12,
  },
  backButtonGradient: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleContainer: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginRight: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 12,
    color: '#FFFFFF',
    textAlign: 'center',
    opacity: 0.9,
  },
  selectButton: {
    padding: 8,
  },
  grid: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  multiSelectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.9)',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 20,
  },
  selectedText: {
    fontWeight: 'bold',
    fontSize: 16,
  },
  multiSelectActions: {
    flexDirection: 'row',
  },
  multiButton: {
    padding: 8,
    marginLeft: 8,
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
    backgroundColor: 'transparent',
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
});

export default DayGalleryScreen;

// import React, { useState } from 'react';
// import {
//   View,
//   Text,
//   FlatList,
//   StyleSheet,
//   TouchableOpacity,
//   ActivityIndicator,
//   Platform,
// } from 'react-native';
// import { SafeAreaView } from 'react-native-safe-area-context';
// import PhotoGridItem from '../components/PhotoGridItem';
// import { useTheme } from '../theme/ThemeContext';
// import Icon from 'react-native-vector-icons/Ionicons';
// import ImageViewing from 'react-native-image-viewing';
// import Share from 'react-native-share';
// import BlobUtil from 'react-native-blob-util';
// import { supabase } from '../services/supabase';
// import Modal from 'react-native-modal';
// import ErrorModal from '../components/ErrorModal';

// const DayGalleryScreen = ({ route, navigation }) => {
//   const { theme } = useTheme();
//   const { date, images: initialImages } = route.params;

//   const [images, setImages] = useState(initialImages || []);
//   const [isViewerVisible, setIsViewerVisible] = useState(false);
//   const [currentIndex, setCurrentIndex] = useState(0);
//   const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
//   const [selectedImage, setSelectedImage] = useState(null);
//   const [errorModal, setErrorModal] = useState({ visible: false, message: '' });
//   const [successModal, setSuccessModal] = useState({
//     visible: false,
//     message: '',
//   });
//   const [loading, setLoading] = useState(false);

//   // Debug log for every render
//   console.log('[DayGalleryScreen] Render', {
//     imagesCount: images.length,
//     date,
//   });

//   // Open image viewer
//   const openImage = index => {
//     setCurrentIndex(index);
//     setIsViewerVisible(true);
//     console.log(
//       '[DayGalleryScreen] Opened viewer for image:',
//       images[index]?.id,
//       'at index',
//       index,
//     );
//   };

//   // Open delete modal
//   const openDeleteModal = image => {
//     setSelectedImage(image);
//     setIsDeleteModalVisible(true);
//     console.log('[DayGalleryScreen] Opened delete modal for image:', image.id);
//   };

//   // Delete image
//   const handleDelete = async () => {
//     if (!selectedImage) return;
//     try {
//       const { error } = await supabase
//         .from('images')
//         .delete()
//         .eq('id', selectedImage.id);
//       if (error) {
//         setErrorModal({ visible: true, message: error.message });
//       } else {
//         setIsDeleteModalVisible(false);
//         setSelectedImage(null);
//         setImages(images.filter(img => img.id !== selectedImage.id));
//         console.log('[DayGalleryScreen] Deleted image:', selectedImage.id);
//       }
//     } catch (e) {
//       setErrorModal({ visible: true, message: e.message });
//     }
//   };

//   // Share image
//   const handleShare = async () => {
//     try {
//       const image = images[currentIndex];
//       if (!image) return;
//       await Share.open({ url: image.image_url });
//       console.log('[DayGalleryScreen] Shared image:', image.image_url);
//     } catch (e) {
//       setErrorModal({ visible: true, message: e.message });
//     }
//   };

//   // Save image to device
//   const handleSave = async () => {
//     try {
//       const image = images[currentIndex];
//       if (!image) return;
//       const fileUrl = image.image_url;
//       const fileName = fileUrl.split('/').pop();
//       const dirs = BlobUtil.fs.dirs;
//       const downloadDest =
//         Platform.OS === 'android'
//           ? `${dirs.DownloadDir}/${fileName}`
//           : `${dirs.DocumentDir}/${fileName}`;
//       await BlobUtil.config({ path: downloadDest }).fetch('GET', fileUrl);
//       setSuccessModal({
//         visible: true,
//         message: 'Image saved to your device.',
//       });
//       console.log('[DayGalleryScreen] Saved image to device:', downloadDest);
//     } catch (e) {
//       setErrorModal({ visible: true, message: e.message });
//     }
//   };

//   // Toggle favorite
//   const handleToggleFavorite = async image => {
//     try {
//       const updated = !image.favorite;
//       await supabase
//         .from('images')
//         .update({ favorite: updated })
//         .eq('id', image.id);
//       setImages(prev =>
//         prev.map(img =>
//           img.id === image.id ? { ...img, favorite: updated } : img,
//         ),
//       );
//       console.log(
//         '[DayGalleryScreen] Toggled favorite for image:',
//         image.id,
//         'Now:',
//         updated,
//       );
//     } catch (e) {
//       setErrorModal({ visible: true, message: e.message });
//     }
//   };

//   // Render each image in grid
//   const renderItem = ({ item, index }) => (
//     <PhotoGridItem image={item} onPress={() => openImage(index)} />
//   );

//   return (
//     <SafeAreaView
//       style={[
//         styles.container,
//         { backgroundColor: theme.colors.primary + '20' },
//       ]}
//     >
//       <View style={styles.header}>
//         <TouchableOpacity onPress={() => navigation.goBack()}>
//           <Icon name="arrow-back" size={28} color={theme.colors.primary} />
//         </TouchableOpacity>
//         <Text style={[styles.title, { color: theme.colors.primary }]}>
//           {date}
//         </Text>
//         <View style={{ width: 28 }} />
//       </View>
//       {loading ? (
//         <ActivityIndicator size="large" color={theme.colors.primary} />
//       ) : (
//         <FlatList
//           data={images}
//           numColumns={2}
//           keyExtractor={item => item.id.toString()}
//           contentContainerStyle={styles.grid}
//           renderItem={renderItem}
//         />
//       )}

//       {/* Image Viewer */}
//       <ImageViewing
//         images={images.map(img => ({ uri: img.image_url }))}
//         imageIndex={currentIndex}
//         visible={isViewerVisible}
//         onRequestClose={() => setIsViewerVisible(false)}
//         FooterComponent={() => {
//           const image = images[currentIndex];
//           if (!image) return null;
//           return (
//             <View style={styles.viewerFooter}>
//               <TouchableOpacity
//                 style={styles.viewerButton}
//                 onPress={handleShare}
//               >
//                 <Icon name="share-social-outline" size={22} color="#fff" />
//               </TouchableOpacity>
//               <TouchableOpacity
//                 style={styles.viewerButton}
//                 onPress={handleSave}
//               >
//                 <Icon name="download-outline" size={22} color="#fff" />
//               </TouchableOpacity>
//               <TouchableOpacity
//                 style={styles.viewerButton}
//                 onPress={() => handleToggleFavorite(image)}
//               >
//                 <Icon
//                   name={image.favorite ? 'heart' : 'heart-outline'}
//                   size={22}
//                   color="#FF80AB"
//                 />
//               </TouchableOpacity>
//               <TouchableOpacity
//                 style={styles.viewerButton}
//                 onPress={() => openDeleteModal(image)}
//               >
//                 <Icon name="trash-outline" size={22} color="#FF6347" />
//               </TouchableOpacity>
//             </View>
//           );
//         }}
//       />

//       {/* Delete Modal */}
//       <Modal isVisible={isDeleteModalVisible}>
//         <View style={styles.modalContent}>
//           <Text
//             style={{
//               color: theme.colors.primary,
//               fontSize: 18,
//               marginBottom: 20,
//             }}
//           >
//             Are you sure you want to delete this photo?
//           </Text>
//           <View style={{ flexDirection: 'row' }}>
//             <TouchableOpacity style={styles.modalButton} onPress={handleDelete}>
//               <Text style={{ color: '#fff' }}>Delete</Text>
//             </TouchableOpacity>
//             <TouchableOpacity
//               style={styles.modalButton}
//               onPress={() => setIsDeleteModalVisible(false)}
//             >
//               <Text style={{ color: '#fff' }}>Cancel</Text>
//             </TouchableOpacity>
//           </View>
//         </View>
//       </Modal>
//       {/* Error Modal */}
//       <ErrorModal
//         visible={errorModal.visible}
//         message={errorModal.message}
//         onClose={() => setErrorModal({ visible: false, message: '' })}
//         theme={theme}
//       />
//       {/* Success Modal */}
//       <ErrorModal
//         visible={successModal.visible}
//         message={successModal.message}
//         onClose={() => setSuccessModal({ visible: false, message: '' })}
//         theme={theme}
//       />
//     </SafeAreaView>
//   );
// };

// const styles = StyleSheet.create({
//   container: { flex: 1, padding: 16 },
//   header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
//   title: { flex: 1, textAlign: 'center', fontSize: 20, fontWeight: 'bold' },
//   grid: { paddingBottom: 20 },
//   viewerFooter: {
//     flexDirection: 'row',
//     justifyContent: 'center',
//     alignItems: 'center',
//     marginBottom: 40,
//     width: '100%',
//     position: 'absolute',
//     bottom: 0,
//   },
//   viewerButton: {
//     backgroundColor: 'rgba(0,0,0,0.6)',
//     paddingVertical: 12,
//     paddingHorizontal: 20,
//     borderRadius: 8,
//     marginHorizontal: 10,
//   },
//   modalContent: {
//     backgroundColor: '#fff',
//     padding: 24,
//     borderRadius: 12,
//     alignItems: 'center',
//   },
//   modalButton: {
//     backgroundColor: '#FF80AB',
//     padding: 12,
//     borderRadius: 8,
//     marginHorizontal: 10,
//     minWidth: 80,
//     alignItems: 'center',
//   },
// });

// export default DayGalleryScreen;
