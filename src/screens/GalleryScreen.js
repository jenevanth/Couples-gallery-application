// GalleryScreen.js - Complete with all fixes
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
  UIManager,
  Linking,
  Animated,
  PermissionsAndroid,
  ToastAndroid,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { supabase } from '../services/supabase';
import { launchImageLibrary } from 'react-native-image-picker';
import PhotoGridItem from '../components/PhotoGridItem';
import ImageViewing from 'react-native-image-viewing';
import ErrorModal from '../components/ErrorModal';
import Share from 'react-native-share';
import BlobUtil from 'react-native-blob-util';
import Icon from 'react-native-vector-icons/Ionicons';
import Modal from 'react-native-modal';
import Video from 'react-native-video';
import { format, parseISO, isToday, isSameMonth, isSameWeek } from 'date-fns';
import {
  Menu,
  MenuOptions,
  MenuOption,
  MenuTrigger,
} from 'react-native-popup-menu';
import { useFocusEffect } from '@react-navigation/native';
import LinearGradient from 'react-native-linear-gradient';

const log = (...a) => console.log('[Gallery]', ...a);

// Storage/Upload controls
const IMAGEKIT_LIMIT_GB = 19;
const IMAGEKIT_PUBLIC_KEY = 'public_IAZdw7PGwJlYkHZC8/KN4/9TdRw=';

// Filter options
const FILTERS = [
  { label: 'All', value: 'all', icon: 'albums', color: '#667EEA' },
  { label: 'Photos', value: 'photo', icon: 'image', color: '#FF6B9D' },
  { label: 'Videos', value: 'video', icon: 'videocam', color: '#06FFA5' },
  { label: 'Favorites', value: 'favorites', icon: 'heart', color: '#E63946' },
  { label: 'This Month', value: 'month', icon: 'calendar', color: '#FFD60A' },
  { label: 'This Week', value: 'week', icon: 'today', color: '#00D4FF' },
];

// Instagram-style reactions
const REACTIONS = ['❤️', '😍', '🔥', '💕', '✨', '😊'];

// Slideshow durations
const SLIDESHOW_DURATIONS = [
  { label: '3 sec', value: 3000 },
  { label: '5 sec', value: 5000 },
  { label: '10 sec', value: 10000 },
  { label: '15 sec', value: 15000 },
];

const { width, height } = Dimensions.get('window');

const GalleryScreen = ({ navigation }) => {
  const { theme } = useTheme();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const reactionAnim = useRef(new Animated.Value(0)).current;

  // Data
  const [images, setImages] = useState([]);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [userId, setUserId] = useState('');
  const [userName, setUserName] = useState('');

  // UI state
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  // Search & Filter
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);

  // Photo viewer
  const [isViewerVisible, setIsViewerVisible] = useState(false);
  const [photoViewerIndex, setPhotoViewerIndex] = useState(0);
  const [showFooter, setShowFooter] = useState(true);
  const [showPhotoInfo, setShowPhotoInfo] = useState(false);
  const [slideshowActive, setSlideshowActive] = useState(false);
  const [slideshowDuration, setSlideshowDuration] = useState(5000);
  const [showDurationPicker, setShowDurationPicker] = useState(false);

  // Video viewer
  const [videoVisible, setVideoVisible] = useState(false);
  const [videoUri, setVideoUri] = useState('');

  // Reactions
  const [showReactions, setShowReactions] = useState(false);
  const [imageReactions, setImageReactions] = useState({});

  // Multi-select
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);

  // Status modals
  const [errorModal, setErrorModal] = useState({ visible: false, message: '' });
  const [successModal, setSuccessModal] = useState({
    visible: false,
    message: '',
  });

  // Slideshow timer
  const slideshowTimer = useRef(null);

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

  // Detect native video module
  const videoSupportedRef = useRef(false);
  useEffect(() => {
    try {
      const cfg = UIManager.getViewManagerConfig
        ? UIManager.getViewManagerConfig('RCTVideo')
        : UIManager.RCTVideo;
      videoSupportedRef.current = !!cfg;
      log('RCTVideo available:', !!cfg);
    } catch (e) {
      log('RCTVideo VM lookup error:', e);
      videoSupportedRef.current = false;
    }
  }, []);

  // Log render summary
  log('Render', {
    loading,
    count: images.length,
    search,
    filter,
    multiSelect,
    selectedIdsLen: selectedIds.length,
    uploading,
    progress,
    slideshowActive,
    slideshowDuration,
  });

  // Load auth + avatar + profile
  const fetchProfileAvatar = useCallback(async () => {
    try {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (error) log('getUser error:', error);
      if (!user) {
        log('No auth user - avatar fetch skipped');
        return;
      }
      setUserId(user.id);
      const { data, error: pErr } = await supabase
        .from('profiles')
        .select('avatar_url, username')
        .eq('id', user.id)
        .maybeSingle();
      if (pErr) log('profile fetch error:', pErr);
      setAvatarUrl(data?.avatar_url || '');
      setUserName(data?.username || 'User');
      log('Loaded profile:', data?.avatar_url, data?.username);
    } catch (e) {
      log('fetchProfileAvatar exception:', e);
    }
  }, []);

  useEffect(() => {
    fetchProfileAvatar();
  }, [fetchProfileAvatar]);

  useFocusEffect(
    useCallback(() => {
      fetchProfileAvatar();
    }, [fetchProfileAvatar]),
  );

  // Fetch images
  const fetchImages = useCallback(async () => {
    try {
      log('--- Fetching images from Supabase... ---');
      setLoading(true);
      const { data, error } = await supabase
        .from('images')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setImages(data || []);
      log('Supabase fetch success. Images count:', data?.length);
    } catch (e) {
      log('Fetch error:', e);
      setErrorModal({ visible: true, message: e.message || String(e) });
      setImages([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
      log('--- Fetching images complete ---');
    }
  }, []);

  // Fetch reactions for images
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

      log('Fetched reactions');
    } catch (e) {
      log('Error fetching reactions:', e);
    }
  }, []);

  useEffect(() => {
    fetchImages();
    fetchReactions();
    const ch = supabase
      .channel('public:images')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'images' },
        payload => {
          log(
            'Realtime event:',
            payload.eventType,
            payload.new?.id || payload.old?.id,
          );
          fetchImages();
        },
      )
      .subscribe();

    // Subscribe to reactions changes
    const reactionsChannel = supabase
      .channel('public:reactions')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reactions' },
        () => {
          fetchReactions();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
      supabase.removeChannel(reactionsChannel);
      log('Realtime channels removed');
    };
  }, [fetchImages, fetchReactions]);

  // Group by date
  const groupImagesByDate = useCallback(arr => {
    const groups = {};
    for (const img of arr) {
      const date = format(parseISO(img.created_at), 'yyyy-MM-dd');
      if (!groups[date]) groups[date] = [];
      groups[date].push(img);
    }
    return groups;
  }, []);

  // Filters
  const filteredImages = useMemo(() => {
    let list = images;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        img =>
          img.image_url?.toLowerCase().includes(q) ||
          img.file_name?.toLowerCase().includes(q),
      );
    }
    if (filter === 'photo') list = list.filter(img => img.type === 'photo');
    else if (filter === 'video')
      list = list.filter(img => img.type === 'video');
    else if (filter === 'favorites') list = list.filter(img => img.favorite);
    else if (filter === 'month')
      list = list.filter(img =>
        isSameMonth(parseISO(img.created_at), new Date()),
      );
    else if (filter === 'week')
      list = list.filter(img =>
        isSameWeek(parseISO(img.created_at), new Date(), { weekStartsOn: 1 }),
      );
    return list;
  }, [images, search, filter]);

  const photosOnly = useMemo(
    () => filteredImages.filter(i => i.type !== 'video'),
    [filteredImages],
  );

  const groupedImages = useMemo(
    () => groupImagesByDate(filteredImages),
    [filteredImages, groupImagesByDate],
  );

  // Upload handler
  const handleImagePickAndUpload = () => {
    log('Launching image library picker...');
    launchImageLibrary(
      { mediaType: 'mixed', selectionLimit: 0 },
      async response => {
        log('Picker response:', {
          didCancel: response?.didCancel,
          errorCode: response?.errorCode,
          assetsLen: response?.assets?.length,
          platform: Platform.OS,
        });
        if (response?.didCancel) return;
        if (response?.errorCode) {
          return setErrorModal({
            visible: true,
            message: response.errorMessage || 'Picker error',
          });
        }
        const assets = response?.assets;
        if (!assets?.length) return;

        try {
          setUploading(true);
          let successCount = 0;

          log('Checking ImageKit usage limit...');
          const usageRes = await fetch(
            'https://boyfriend-needs-backend.vercel.app/api/imagekit-usage',
          );
          const usage = await usageRes.json();
          const useImageKit = usage?.totalGB < IMAGEKIT_LIMIT_GB;
          log('Usage response:', usage);
          log('Upload will use:', useImageKit ? 'ImageKit' : 'Cloudinary');

          const {
            data: { user },
          } = await supabase.auth.getUser();
          log('Auth user fetched for upload:', !!user, user?.id);
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
            log(`[${i + 1}/${assets.length}] Processing asset:`, {
              fileName: asset.fileName,
              type: asset.type,
              uri: asset.uri,
              fileSize: asset.fileSize,
              width: asset.width,
              height: asset.height,
            });

            setProgress(0);
            const isVideo = asset.type?.startsWith('video');
            const type = isVideo ? 'video' : 'photo';

            let uploadUrl = '';
            let storageType = '';

            if (useImageKit) {
              try {
                log(
                  `[${i + 1}/${assets.length}] Getting ImageKit signature...`,
                );
                const signatureData = await fetch(
                  'https://boyfriend-needs-backend.vercel.app/api/imagekit-auth',
                ).then(res => res.json());
                log('ImageKit signature received.');

                const fileName = asset.fileName || `media_${Date.now()}_${i}`;
                const wrappedPath = BlobUtil.wrap(
                  (asset.uri || '').startsWith('file://')
                    ? asset.uri.replace('file://', '')
                    : asset.uri || '',
                );
                const uploadData = [
                  { name: 'file', filename: fileName, data: wrappedPath },
                  { name: 'publicKey', data: IMAGEKIT_PUBLIC_KEY },
                  { name: 'signature', data: signatureData.signature },
                  { name: 'expire', data: String(signatureData.expire) },
                  { name: 'token', data: signatureData.token },
                  { name: 'fileName', data: fileName },
                ];

                log(`[${i + 1}/${assets.length}] Uploading to ImageKit...`);
                const tStart = Date.now();
                const task = BlobUtil.fetch(
                  'POST',
                  'https://upload.imagekit.io/api/v1/files/upload',
                  {},
                  uploadData,
                );
                task.uploadProgress((written, total) => {
                  const pct =
                    total > 0 ? Math.round((written / total) * 100) : 0;
                  setProgress(pct);
                });

                const uploadResult = await task;
                const resultJson = uploadResult.json();
                const status = uploadResult.info().status;
                log('ImageKit upload HTTP status:', status);
                if (status >= 300)
                  throw new Error(
                    resultJson?.message || 'ImageKit upload failed',
                  );

                uploadUrl = resultJson.url;
                storageType = 'imagekit';
                log(
                  'ImageKit upload success:',
                  uploadUrl,
                  'timeMs:',
                  Date.now() - tStart,
                );
              } catch (e) {
                log(
                  'ImageKit upload error, falling back to Cloudinary:',
                  e?.message || e,
                );
                const fileBase64 = await BlobUtil.fs.readFile(
                  (asset.uri || '').replace('file://', ''),
                  'base64',
                );
                log('Uploading to Cloudinary...');
                const tStart = Date.now();
                const cloudRes = await fetch(
                  'https://boyfriend-needs-backend.vercel.app/api/cloudinary-upload',
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      fileBase64: `data:${asset.type};base64,${fileBase64}`,
                    }),
                  },
                );
                const cloudJson = await cloudRes.json();
                if (!cloudJson.url) throw new Error('Cloudinary upload failed');
                uploadUrl = cloudJson.url;
                storageType = 'cloudinary';
                log(
                  'Cloudinary upload success:',
                  uploadUrl,
                  'timeMs:',
                  Date.now() - tStart,
                );
              }
            } else {
              log('Directly uploading to Cloudinary (usage limit reached)...');
              const fileBase64 = await BlobUtil.fs.readFile(
                (asset.uri || '').replace('file://', ''),
                'base64',
              );
              const tStart = Date.now();
              const cloudRes = await fetch(
                'https://boyfriend-needs-backend.vercel.app/api/cloudinary-upload',
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    fileBase64: `data:${asset.type};base64,${fileBase64}`,
                  }),
                },
              );
              const cloudJson = await cloudRes.json();
              if (!cloudJson.url) throw new Error('Cloudinary upload failed');
              uploadUrl = cloudJson.url;
              storageType = 'cloudinary';
              log(
                'Cloudinary upload success:',
                uploadUrl,
                'timeMs:',
                Date.now() - tStart,
              );
            }

            // Insert row
            log('Inserting row into Supabase images table...', {
              user_id: user.id,
              type,
              storageType,
              fileName: asset.fileName || '',
              uploadUrl,
            });

            const { data: inserted, error: sErr } = await supabase
              .from('images')
              .insert({
                user_id: user.id,
                image_url: uploadUrl,
                storage_type: storageType,
                created_at: new Date().toISOString(),
                file_name: asset.fileName || '',
                favorite: false,
                type,
                private: false,
              })
              .select('*')
              .single();

            if (sErr || !inserted) {
              log('Supabase insert error:', sErr, 'inserted:', inserted);
              setErrorModal({
                visible: true,
                message: sErr?.message || 'Insert failed',
              });
              break;
            }

            log('Supabase insert success. Inserted row:', inserted);

            // Edge Function: push notification for new item
            try {
              log(
                'Invoking edge function push-new-image-v1 with image_id:',
                inserted.id,
              );
              const tFn = Date.now();
              const { data: fnRes, error: fnErr } =
                await supabase.functions.invoke('push-new-image-v1', {
                  body: { image_id: inserted.id },
                });
              const fnMs = Date.now() - tFn;
              if (fnErr) {
                log(
                  'Edge function push-new-image-v1 ERROR:',
                  fnErr,
                  'durationMs:',
                  fnMs,
                );
              } else {
                log('Edge function push-new-image-v1 OK.', 'durationMs:', fnMs);
              }
            } catch (fnCatch) {
              log('Edge function invoke exception:', fnCatch);
            }

            successCount++;
            log(
              `[${i + 1}/${assets.length}] Completed upload+insert${
                isVideo ? ' (video)' : ' (photo)'
              }. image_id:`,
              inserted.id,
            );
          }

          if (successCount > 0) {
            setSuccessModal({
              visible: true,
              message: `${successCount} file(s) uploaded!`,
            });
            log('Refreshing images after uploads...');
            fetchImages();
          } else {
            log('No successful uploads.');
          }
        } catch (e) {
          log('Upload exception:', e);
          setErrorModal({ visible: true, message: e.message || String(e) });
        } finally {
          setUploading(false);
          setProgress(0);
          log('Upload flow finished. uploading=false');
        }
      },
    );
  };

  const onRefresh = () => {
    setRefreshing(true);
    log('Pull-to-refresh triggered.');
    fetchImages();
    fetchReactions();
  };

  // Open item (photo or video)
  const openItem = item => {
    log('Open item requested:', { id: item.id, type: item.type });
    if (multiSelect) {
      toggleSelect(item.id);
      return;
    }
    if (item.type === 'video') {
      if (videoSupportedRef.current) {
        setVideoUri(item.image_url);
        setVideoVisible(true);
        log('Open video viewer for id:', item.id);
      } else {
        log('RCTVideo not available. Opening external player.');
        Alert.alert(
          'Opening externally',
          'Native video module missing; opening in external player.',
        );
        Linking.openURL(item.image_url);
      }
    } else {
      const idx = photosOnly.findIndex(p => p.id === item.id);
      setPhotoViewerIndex(Math.max(0, idx));
      setIsViewerVisible(true);
      setShowFooter(true);
      setShowReactions(false);
      setShowPhotoInfo(false);
      setShowDurationPicker(false);
      log('Open photo viewer for id:', item.id, 'photoIndex:', idx);
    }
  };

  // Single delete (from viewer footer)
  const deleteCurrentPhoto = async () => {
    const img = photosOnly[photoViewerIndex];
    if (!img) return;
    log('Delete current photo requested:', img.id);
    Alert.alert('Delete', 'Delete this photo?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase
            .from('images')
            .delete()
            .eq('id', img.id);
          if (error) {
            setErrorModal({ visible: true, message: error.message });
            log('Delete error:', error);
          } else {
            setIsViewerVisible(false);
            fetchImages();
            log('Deleted photo id:', img.id);
          }
        },
      },
    ]);
  };

  const handleShareCurrent = async () => {
    try {
      const img = photosOnly[photoViewerIndex];
      if (!img) return;
      await Share.open({ url: img.image_url });
      log('Shared photo:', img.image_url);
    } catch (e) {
      log('Share error:', e);
      if (e?.message !== 'User did not share') {
        setErrorModal({ visible: true, message: e.message });
      }
    }
  };

  const handleSaveCurrent = async () => {
    try {
      const img = photosOnly[photoViewerIndex];
      if (!img) return;

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

      const fileUrl = img.image_url;
      const fileName =
        img.file_name || fileUrl.split('/').pop() || `image_${Date.now()}.jpg`;
      const dirs = BlobUtil.fs.dirs;

      const dest =
        Platform.OS === 'android'
          ? `${dirs.PictureDir}/Gallery/${fileName}`
          : `${dirs.DocumentDir}/${fileName}`;

      log('Saving file to device...', { dest, fileUrl });

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
      log('Saved file to:', dest);
    } catch (e) {
      log('Save error:', e);
      setErrorModal({ visible: true, message: 'Failed to save: ' + e.message });
    }
  };

  const toggleFavoriteCurrent = async () => {
    const img = photosOnly[photoViewerIndex];
    if (!img) return;
    try {
      const updated = !img.favorite;
      await supabase
        .from('images')
        .update({ favorite: updated })
        .eq('id', img.id);
      setImages(prev =>
        prev.map(i => (i.id === img.id ? { ...i, favorite: updated } : i)),
      );
      log('Toggled favorite id:', img.id, '->', updated);
    } catch (e) {
      setErrorModal({ visible: true, message: e.message });
      log('Toggle favorite error:', e);
    }
  };

  // Toggle reaction (Instagram-style)
  const toggleReaction = async emoji => {
    const img = photosOnly[photoViewerIndex];
    if (!img) return;

    try {
      // Check if user already reacted with this emoji
      const existingReactions = imageReactions[img.id] || [];
      const userReaction = existingReactions.find(
        r => r.user_id === userId && r.emoji === emoji,
      );

      if (userReaction) {
        // Remove reaction if already exists
        log('Removing reaction:', emoji, 'from image:', img.id);
        const { error } = await supabase
          .from('reactions')
          .delete()
          .match({ image_id: img.id, user_id: userId, emoji });

        if (error) throw error;

        // Update local state
        setImageReactions(prev => ({
          ...prev,
          [img.id]: prev[img.id].filter(
            r => !(r.user_id === userId && r.emoji === emoji),
          ),
        }));

        log('Removed reaction successfully');
      } else {
        // Add new reaction
        log('Adding reaction:', emoji, 'to image:', img.id);
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
          created_at: new Date().toISOString(),
        });

        if (error) throw error;

        // Update local state immediately
        setImageReactions(prev => ({
          ...prev,
          [img.id]: [...(prev[img.id] || []), { user_id: userId, emoji }],
        }));

        log('Added reaction successfully');
      }
    } catch (e) {
      log('Error toggling reaction:', e);
      setErrorModal({ visible: true, message: 'Failed to update reaction' });
    }
  };

  // Start/stop slideshow with custom duration
  const toggleSlideshow = () => {
    if (slideshowActive) {
      clearInterval(slideshowTimer.current);
      setSlideshowActive(false);
      log('Slideshow stopped');
    } else {
      setSlideshowActive(true);
      slideshowTimer.current = setInterval(() => {
        setPhotoViewerIndex(prev => {
          const next = (prev + 1) % photosOnly.length;
          log('Slideshow next photo:', next, 'duration:', slideshowDuration);
          return next;
        });
      }, slideshowDuration);
      log('Slideshow started with duration:', slideshowDuration);
    }
  };

  // Update slideshow when duration changes
  useEffect(() => {
    if (slideshowActive) {
      clearInterval(slideshowTimer.current);
      slideshowTimer.current = setInterval(() => {
        setPhotoViewerIndex(prev => {
          const next = (prev + 1) % photosOnly.length;
          return next;
        });
      }, slideshowDuration);
      log('Slideshow duration updated to:', slideshowDuration);
    }
  }, [slideshowDuration, slideshowActive, photosOnly.length]);

  // Cleanup slideshow on unmount
  useEffect(() => {
    return () => {
      if (slideshowTimer.current) {
        clearInterval(slideshowTimer.current);
      }
    };
  }, []);

  // Multi-select helpers
  const toggleSelect = id => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id],
    );
    log('Toggle select id:', id);
  };

  const startMultiSelect = id => {
    if (!multiSelect) setMultiSelect(true);
    toggleSelect(id);
    log('Multi-select start/toggle id:', id);
  };

  const handleBatchDelete = async () => {
    if (!selectedIds.length) return;
    log('Batch delete requested count:', selectedIds.length);
    Alert.alert('Delete', `Delete ${selectedIds.length} item(s)?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('images').delete().in('id', selectedIds);
          setSelectedIds([]);
          setMultiSelect(false);
          fetchImages();
          log('Batch deleted count:', selectedIds.length);
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
      log('Batch share urls:', urls.length);
    } catch (e) {
      log('Batch share error/cancel:', e?.message || e);
    }
  };

  const handleBatchFavoriteToggle = async () => {
    if (!selectedIds.length) return;
    try {
      const selectedItems = images.filter(i => selectedIds.includes(i.id));
      const makeFav = selectedItems.some(i => !i.favorite);
      await supabase
        .from('images')
        .update({ favorite: makeFav })
        .in('id', selectedIds);
      setImages(prev =>
        prev.map(i =>
          selectedIds.includes(i.id) ? { ...i, favorite: makeFav } : i,
        ),
      );
      log('Batch favorite ->', makeFav, 'count:', selectedIds.length);
    } catch (e) {
      setErrorModal({ visible: true, message: e.message });
      log('Batch favorite error:', e);
    }
  };

  const handleSelectAll = () => {
    const ids = filteredImages.map(i => i.id);
    setSelectedIds(ids);
    setMultiSelect(true);
    log('Selected all:', ids.length);
  };

  // Render each date section
  const renderSection = (date, imagesArr) => {
    const showSeeAll = imagesArr.length > 4;
    const imagesToShow = showSeeAll ? imagesArr.slice(0, 4) : imagesArr;

    return (
      <Animated.View
        key={date}
        style={[
          styles.section,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        <LinearGradient
          colors={[theme.colors.ultraLight, 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.sectionHeaderGradient}
        >
          <View style={styles.sectionHeader}>
            <Text
              style={[styles.sectionTitle, { color: theme.colors.primary }]}
            >
              {isToday(parseISO(date))
                ? '✨ Today'
                : format(parseISO(date), 'MMMM d, yyyy')}
            </Text>
            {showSeeAll && (
              <TouchableOpacity
                onPress={() =>
                  navigation.navigate('DayGallery', { date, images: imagesArr })
                }
                style={styles.seeAllButton}
              >
                <LinearGradient
                  colors={theme.gradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.seeAllGradient}
                >
                  <Text style={styles.seeAll}>See All</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}
          </View>
        </LinearGradient>
        <FlatList
          data={imagesToShow}
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
  };

  // Loading UI
  if (loading) {
    return (
      <LinearGradient colors={theme.gradient} style={styles.loader}>
        <ActivityIndicator size="large" color="#FFFFFF" />
        <Text style={styles.loadingText}>Loading your memories...</Text>
      </LinearGradient>
    );
  }

  // Main UI
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
          <TouchableOpacity
            onPress={() => navigation.navigate('Profile')}
            style={styles.avatarContainer}
          >
            <LinearGradient
              colors={theme.gradient}
              style={styles.avatarGradient}
            >
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatar} />
              ) : (
                <Icon name="person" size={24} color="#FFFFFF" />
              )}
            </LinearGradient>
          </TouchableOpacity>

          <LinearGradient
            colors={theme.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.headerTitleContainer}
          >
            <Text style={styles.headerTitle}>Our Gallery 💕</Text>
          </LinearGradient>

          <Menu>
            <MenuTrigger>
              <View style={styles.menuTrigger}>
                <Icon name="sparkles" size={24} color={theme.colors.primary} />
              </View>
            </MenuTrigger>
            <MenuOptions customStyles={menuOptionsStyles}>
              <MenuOption
                onSelect={() => navigation.navigate('SharedCalendar')}
              >
                <View style={styles.menuOptionContainer}>
                  <Icon name="calendar" size={20} color={theme.shared.purple} />
                  <Text style={styles.menuOption}>Shared Calendar</Text>
                </View>
              </MenuOption>
              <MenuOption onSelect={() => navigation.navigate('PhotoVault')}>
                <View style={styles.menuOptionContainer}>
                  <Icon
                    name="lock-closed"
                    size={20}
                    color={theme.shared.gold}
                  />
                  <Text style={styles.menuOption}>Photo Vault</Text>
                </View>
              </MenuOption>
              <MenuOption
                onSelect={() => navigation.navigate('Personalization')}
              >
                <View style={styles.menuOptionContainer}>
                  <Icon
                    name="color-palette"
                    size={20}
                    color={theme.shared.orange}
                  />
                  <Text style={styles.menuOption}>Personalization</Text>
                </View>
              </MenuOption>
              <MenuOption
                onSelect={async () => {
                  await supabase.auth.signOut();
                  navigation.reset({
                    index: 0,
                    routes: [{ name: 'ProfileSelector' }],
                  });
                }}
              >
                <View style={styles.menuOptionContainer}>
                  <Icon name="log-out" size={20} color={theme.shared.red} />
                  <Text
                    style={[styles.menuOption, { color: theme.shared.red }]}
                  >
                    Sign Out
                  </Text>
                </View>
              </MenuOption>
            </MenuOptions>
          </Menu>
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
                  onPress={handleBatchFavoriteToggle}
                  style={styles.multiSelectButton}
                >
                  <Icon name="heart" size={22} color={theme.shared.red} />
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

        {/* Search + Filter + toggle */}
        <Animated.View
          style={[
            styles.searchBar,
            {
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }],
            },
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
                {
                  color: theme.colors.primary,
                  fontWeight: '500',
                },
              ]}
              placeholder="Search memories..."
              placeholderTextColor={theme.colors.primary + '60'}
              value={search}
              onChangeText={t => {
                setSearch(t);
                log('Search changed:', t);
              }}
              selectionColor={theme.colors.primary}
            />
            <TouchableOpacity
              onPress={() => setShowFilterDropdown(v => !v)}
              style={styles.filterButton}
            >
              <LinearGradient
                colors={theme.gradient}
                style={styles.filterGradient}
              >
                <Icon name="options" size={20} color="#FFFFFF" />
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setMultiSelect(v => !v)}
              style={styles.selectButton}
            >
              <Icon
                name={multiSelect ? 'checkbox' : 'checkbox-outline'}
                size={24}
                color={theme.colors.primary}
              />
            </TouchableOpacity>
          </LinearGradient>
        </Animated.View>

        {/* Filter Dropdown */}
        {showFilterDropdown && (
          <Animated.View
            style={[
              styles.dropdown,
              {
                opacity: fadeAnim,
                transform: [{ scale: scaleAnim }],
              },
            ]}
          >
            {FILTERS.map(f => (
              <TouchableOpacity
                key={f.value}
                style={[
                  styles.dropdownItem,
                  filter === f.value && styles.dropdownItemActive,
                ]}
                onPress={() => {
                  setFilter(f.value);
                  setShowFilterDropdown(false);
                  log('Filter set to:', f.value);
                }}
              >
                <Icon
                  name={f.icon}
                  size={18}
                  color={filter === f.value ? f.color : theme.gray.dark}
                />
                <Text
                  style={[
                    styles.dropdownText,
                    {
                      color: filter === f.value ? f.color : theme.gray.dark,
                      fontWeight: filter === f.value ? 'bold' : 'normal',
                    },
                  ]}
                >
                  {f.label}
                </Text>
              </TouchableOpacity>
            ))}
          </Animated.View>
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
          <Animated.View
            style={[
              styles.uploadStatus,
              {
                opacity: fadeAnim,
              },
            ]}
          >
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

        {/* Enhanced Photo Viewer with Instagram-like features */}
        <ImageViewing
          images={photosOnly.map(img => ({ uri: img.image_url }))}
          imageIndex={photoViewerIndex}
          visible={isViewerVisible}
          onRequestClose={() => {
            setIsViewerVisible(false);
            if (slideshowActive) toggleSlideshow();
          }}
          doubleTapToZoomEnabled
          swipeToCloseEnabled
          onImageIndexChange={idx => {
            setPhotoViewerIndex(idx);
            setShowFooter(true);
            setShowReactions(false);
            setShowPhotoInfo(false);
            setShowDurationPicker(false);
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
            const img = photosOnly[photoViewerIndex];
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
                          log('Slideshow duration set to:', duration.label);
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
                      Name: {img.file_name || 'Untitled'}
                    </Text>
                    <Text style={styles.photoInfoText}>
                      Date: {format(parseISO(img.created_at), 'PPpp')}
                    </Text>
                    <Text style={styles.photoInfoText}>
                      Storage: {img.storage_type}
                    </Text>
                    <Text style={styles.photoInfoText}>Type: {img.type}</Text>
                  </LinearGradient>
                )}

                {/* Instagram-style reactions with transparent background */}
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

                {/* Main Footer Actions */}
                <LinearGradient
                  colors={['transparent', 'rgba(0,0,0,0.8)']}
                  style={styles.viewerFooter}
                >
                  <TouchableOpacity
                    style={styles.viewerButton}
                    onPress={handleShareCurrent}
                  >
                    <Icon name="share-social" size={24} color="#FFFFFF" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.viewerButton}
                    onPress={handleSaveCurrent}
                  >
                    <Icon name="download" size={24} color="#FFFFFF" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.viewerButton}
                    onPress={toggleFavoriteCurrent}
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
                    onPress={deleteCurrentPhoto}
                  >
                    <Icon name="trash" size={24} color={theme.shared.red} />
                  </TouchableOpacity>
                </LinearGradient>
              </View>
            );
          }}
        />

        {/* Video Viewer */}
        <Modal
          isVisible={videoVisible}
          onBackdropPress={() => setVideoVisible(false)}
          onBackButtonPress={() => setVideoVisible(false)}
          style={{ margin: 0 }}
          useNativeDriver
          hideModalContentWhileAnimating
        >
          <View style={{ flex: 1, backgroundColor: '#000' }}>
            <Video
              source={{ uri: videoUri }}
              style={{ width: '100%', height: '100%' }}
              controls
              paused={false}
              resizeMode="contain"
              onError={e => log('Video error:', e)}
              onLoad={meta => log('Video loaded duration:', meta.duration)}
              posterResizeMode="cover"
            />
            <TouchableOpacity
              onPress={() => setVideoVisible(false)}
              style={styles.videoCloseButton}
            >
              <LinearGradient
                colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,0.8)']}
                style={styles.videoCloseGradient}
              >
                <Icon name="close" size={24} color="#FFFFFF" />
              </LinearGradient>
            </TouchableOpacity>
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

// Enhanced Styles
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
    paddingVertical: 12,
    justifyContent: 'space-between',
  },
  avatarContainer: {
    marginRight: 12,
  },
  avatarGradient: {
    width: 44,
    height: 44,
    borderRadius: 22,
    padding: 2,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFF',
    resizeMode: 'cover',
  },
  headerTitleContainer: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  menuTrigger: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.9)',
    elevation: 2,
  },
  menuOptionContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  menuOption: {
    fontSize: 16,
    marginLeft: 12,
    color: '#222',
    fontWeight: '500',
  },

  searchBar: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
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
  searchInput: {
    flex: 1,
    marginLeft: 12,
    fontSize: 16,
  },
  filterButton: {
    marginLeft: 8,
  },
  filterGradient: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectButton: {
    marginLeft: 12,
  },

  section: {
    marginBottom: 24,
    marginHorizontal: 16,
  },
  sectionHeaderGradient: {
    borderRadius: 12,
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  seeAllButton: {
    borderRadius: 16,
  },
  seeAllGradient: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
  },
  seeAll: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },

  fab: {
    position: 'absolute',
    right: 24,
    bottom: 100,
    zIndex: 10,
  },
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

  // FIXED: Transparent background for reactions
  reactionsContainer: {
    position: 'absolute',
    bottom: 100,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: 'transparent', // No background color - fully transparent
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

  dropdown: {
    position: 'absolute',
    top: 140,
    right: 16,
    zIndex: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    minWidth: 180,
    padding: 8,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginVertical: 2,
  },
  dropdownItemActive: {
    backgroundColor: 'rgba(102, 126, 234, 0.1)',
  },
  dropdownText: {
    marginLeft: 12,
    fontSize: 15,
  },

  videoCloseButton: {
    position: 'absolute',
    top: 40,
    right: 20,
  },
  videoCloseGradient: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

const menuOptionsStyles = {
  optionsContainer: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 8,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    marginTop: 40,
    marginRight: 16,
  },
};

export default GalleryScreen;

// // GalleryScreen.js
// // Note: Full file in one block, with extensive logs and a couple of debug helpers.
// // - Invokes push-new-image-v1 after each insert (with debug_notify_self: true while you test).
// // - Adds "Test Push (notify me)" and "Log my device tokens" debug options in the header menu.
// // - Keeps the rest of your behavior, styles at the bottom are the same as you shared.
// // - No references to 'active' column (your devices table doesn't have it).
// // - If you still don't see notifications:
// // 1) Make sure Android 13+ POST_NOTIFICATIONS permission is granted.
// // 2) Ensure App.js registers your FCM token to public.devices.
// // 3) Deploy the edge function with secrets set (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FCM_SERVER_KEY).
// // 4) Watch Supabase → Logs & Analytics → Edge Functions during a test push/upload.

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
//   UIManager,
//   Linking,
//   Animated,
// } from 'react-native';
// import { SafeAreaView } from 'react-native-safe-area-context';
// import { useTheme } from '../theme/ThemeContext';
// import { supabase } from '../services/supabase';
// import { launchImageLibrary } from 'react-native-image-picker';
// import PhotoGridItem from '../components/PhotoGridItem';
// import ImageViewing from 'react-native-image-viewing';
// import ErrorModal from '../components/ErrorModal';
// import Share from 'react-native-share';
// import BlobUtil from 'react-native-blob-util';
// import Icon from 'react-native-vector-icons/Ionicons';
// import Modal from 'react-native-modal';
// import Video from 'react-native-video';
// import { format, parseISO, isToday, isSameMonth, isSameWeek } from 'date-fns';
// import {
//   Menu,
//   MenuOptions,
//   MenuOption,
//   MenuTrigger,
// } from 'react-native-popup-menu';
// import CommentsSection from '../components/CommentsSection';
// import { useFocusEffect } from '@react-navigation/native';
// import LinearGradient from 'react-native-linear-gradient';
// import { BlurView } from '@react-native-community/blur';

// const log = (...a) => console.log('[Gallery]', ...a);

// // Storage/Upload controls
// const IMAGEKIT_LIMIT_GB = 19;
// const IMAGEKIT_PUBLIC_KEY = 'public_IAZdw7PGwJlYkHZC8/KN4/9TdRw=';

// // Filter options
// const FILTERS = [
//   { label: 'All', value: 'all', icon: 'albums', color: '#667EEA' },
//   { label: 'Photos', value: 'photo', icon: 'image', color: '#FF6B9D' },
//   { label: 'Videos', value: 'video', icon: 'videocam', color: '#06FFA5' },
//   { label: 'Favorites', value: 'favorites', icon: 'heart', color: '#E63946' },
//   { label: 'This Month', value: 'month', icon: 'calendar', color: '#FFD60A' },
//   { label: 'This Week', value: 'week', icon: 'today', color: '#00D4FF' },
// ];

// const { width } = Dimensions.get('window');

// const GalleryScreen = ({ navigation }) => {
//   const { theme } = useTheme();
//   const fadeAnim = useRef(new Animated.Value(0)).current;
//   const scaleAnim = useRef(new Animated.Value(0.9)).current;

//   // Data
//   const [images, setImages] = useState([]);
//   const [avatarUrl, setAvatarUrl] = useState('');
//   const [userId, setUserId] = useState('');

//   // UI state
//   const [loading, setLoading] = useState(true);
//   const [refreshing, setRefreshing] = useState(false);
//   const [uploading, setUploading] = useState(false);
//   const [progress, setProgress] = useState(0);

//   // Search & Filter
//   const [search, setSearch] = useState('');
//   const [filter, setFilter] = useState('all');
//   const [showFilterDropdown, setShowFilterDropdown] = useState(false);

//   // Photo viewer
//   const [isViewerVisible, setIsViewerVisible] = useState(false);
//   const [photoViewerIndex, setPhotoViewerIndex] = useState(0); // index into photosOnly
//   const [showFooter, setShowFooter] = useState(true); // visible by default

//   // Video viewer (dedicated)
//   const [videoVisible, setVideoVisible] = useState(false);
//   const [videoUri, setVideoUri] = useState('');

//   // Single item actions
//   const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
//   const [selectedImage, setSelectedImage] = useState(null);

//   // Comments
//   const [showComments, setShowComments] = useState(false);

//   // Multi-select
//   const [multiSelect, setMultiSelect] = useState(false);
//   const [selectedIds, setSelectedIds] = useState([]);

//   // Status modals
//   const [errorModal, setErrorModal] = useState({ visible: false, message: '' });
//   const [successModal, setSuccessModal] = useState({
//     visible: false,
//     message: '',
//   });

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

//   // Detect native video module (prevents RCTVideo crash on some setups)
//   const videoSupportedRef = useRef(false);
//   useEffect(() => {
//     try {
//       const cfg = UIManager.getViewManagerConfig
//         ? UIManager.getViewManagerConfig('RCTVideo')
//         : UIManager.RCTVideo;
//       videoSupportedRef.current = !!cfg;
//       log('RCTVideo available:', !!cfg);
//     } catch (e) {
//       log('RCTVideo VM lookup error:', e);
//       videoSupportedRef.current = false;
//     }
//   }, []);

//   // Log each render summary
//   log('Render', {
//     loading,
//     count: images.length,
//     search,
//     filter,
//     multiSelect,
//     selectedIdsLen: selectedIds.length,
//     uploading,
//     progress,
//   });

//   // Load auth + avatar
//   const fetchProfileAvatar = useCallback(async () => {
//     try {
//       const {
//         data: { user },
//         error,
//       } = await supabase.auth.getUser();
//       if (error) log('getUser error:', error);
//       if (!user) {
//         log('No auth user - avatar fetch skipped');
//         return;
//       }
//       setUserId(user.id);
//       const { data, error: pErr } = await supabase
//         .from('profiles')
//         .select('avatar_url')
//         .eq('id', user.id)
//         .maybeSingle();
//       if (pErr) log('profile fetch error:', pErr);
//       setAvatarUrl(data?.avatar_url || '');
//       log('Loaded avatar:', data?.avatar_url);
//     } catch (e) {
//       log('fetchProfileAvatar exception:', e);
//     }
//   }, []);

//   useEffect(() => {
//     fetchProfileAvatar();
//   }, [fetchProfileAvatar]);

//   useFocusEffect(
//     useCallback(() => {
//       fetchProfileAvatar();
//     }, [fetchProfileAvatar]),
//   );

//   // Fetch images
//   const fetchImages = useCallback(async () => {
//     try {
//       log('--- Fetching images from Supabase... ---');
//       setLoading(true);
//       const { data, error } = await supabase
//         .from('images')
//         .select('*')
//         .order('created_at', { ascending: false });
//       if (error) throw error;
//       setImages(data || []);
//       log('Supabase fetch success. Images count:', data?.length);
//     } catch (e) {
//       log('Fetch error:', e);
//       setErrorModal({ visible: true, message: e.message || String(e) });
//       setImages([]);
//     } finally {
//       setLoading(false);
//       setRefreshing(false);
//       log('--- Fetching images complete ---');
//     }
//   }, []);

//   useEffect(() => {
//     fetchImages();
//     const ch = supabase
//       .channel('public:images')
//       .on(
//         'postgres_changes',
//         { event: '*', schema: 'public', table: 'images' },
//         payload => {
//           log(
//             'Realtime event:',
//             payload.eventType,
//             payload.new?.id || payload.old?.id,
//           );
//           fetchImages();
//         },
//       )
//       .subscribe();
//     return () => {
//       supabase.removeChannel(ch);
//       log('Realtime channel removed: public:images');
//     };
//   }, [fetchImages]);

//   // Group by date
//   const groupImagesByDate = useCallback(arr => {
//     const groups = {};
//     for (const img of arr) {
//       const date = format(parseISO(img.created_at), 'yyyy-MM-dd');
//       if (!groups[date]) groups[date] = [];
//       groups[date].push(img);
//     }
//     return groups;
//   }, []);

//   // Filters
//   const filteredImages = useMemo(() => {
//     let list = images;
//     if (search) {
//       const q = search.toLowerCase();
//       list = list.filter(
//         img =>
//           img.image_url?.toLowerCase().includes(q) ||
//           img.file_name?.toLowerCase().includes(q),
//       );
//     }
//     if (filter === 'photo') list = list.filter(img => img.type === 'photo');
//     else if (filter === 'video')
//       list = list.filter(img => img.type === 'video');
//     else if (filter === 'favorites') list = list.filter(img => img.favorite);
//     else if (filter === 'month')
//       list = list.filter(img =>
//         isSameMonth(parseISO(img.created_at), new Date()),
//       );
//     else if (filter === 'week')
//       list = list.filter(img =>
//         isSameWeek(parseISO(img.created_at), new Date(), { weekStartsOn: 1 }),
//       );
//     return list;
//   }, [images, search, filter]);

//   const photosOnly = useMemo(
//     () => filteredImages.filter(i => i.type !== 'video'),
//     [filteredImages],
//   );

//   const groupedImages = useMemo(
//     () => groupImagesByDate(filteredImages),
//     [filteredImages, groupImagesByDate],
//   );

//   // Upload handler
//   const handleImagePickAndUpload = () => {
//     log('Launching image library picker...');
//     launchImageLibrary(
//       { mediaType: 'mixed', selectionLimit: 0 },
//       async response => {
//         log('Picker response:', {
//           didCancel: response?.didCancel,
//           errorCode: response?.errorCode,
//           assetsLen: response?.assets?.length,
//           platform: Platform.OS,
//         });
//         if (response?.didCancel) return;
//         if (response?.errorCode) {
//           return setErrorModal({
//             visible: true,
//             message: response.errorMessage || 'Picker error',
//           });
//         }
//         const assets = response?.assets;
//         if (!assets?.length) return;

//         try {
//           setUploading(true);
//           let successCount = 0;

//           log('Checking ImageKit usage limit...');
//           const usageRes = await fetch(
//             'https://boyfriend-needs-backend.vercel.app/api/imagekit-usage',
//           );
//           const usage = await usageRes.json();
//           const useImageKit = usage?.totalGB < IMAGEKIT_LIMIT_GB;
//           log('Usage response:', usage);
//           log('Upload will use:', useImageKit ? 'ImageKit' : 'Cloudinary');

//           const {
//             data: { user },
//           } = await supabase.auth.getUser();
//           log('Auth user fetched for upload:', !!user, user?.id);
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
//             log(`[${i + 1}/${assets.length}] Processing asset:`, {
//               fileName: asset.fileName,
//               type: asset.type,
//               uri: asset.uri,
//               fileSize: asset.fileSize,
//               width: asset.width,
//               height: asset.height,
//             });

//             setProgress(0);
//             const isVideo = asset.type?.startsWith('video');
//             const type = isVideo ? 'video' : 'photo';

//             let uploadUrl = '';
//             let storageType = '';

//             if (useImageKit) {
//               try {
//                 log(
//                   `[${i + 1}/${assets.length}] Getting ImageKit signature...`,
//                 );
//                 const signatureData = await fetch(
//                   'https://boyfriend-needs-backend.vercel.app/api/imagekit-auth',
//                 ).then(res => res.json());
//                 log('ImageKit signature received.');

//                 const fileName = asset.fileName || `media_${Date.now()}_${i}`;
//                 const wrappedPath = BlobUtil.wrap(
//                   (asset.uri || '').startsWith('file://')
//                     ? asset.uri.replace('file://', '')
//                     : asset.uri || '',
//                 );
//                 const uploadData = [
//                   { name: 'file', filename: fileName, data: wrappedPath },
//                   { name: 'publicKey', data: IMAGEKIT_PUBLIC_KEY },
//                   { name: 'signature', data: signatureData.signature },
//                   { name: 'expire', data: String(signatureData.expire) },
//                   { name: 'token', data: signatureData.token },
//                   { name: 'fileName', data: fileName },
//                 ];

//                 log(`[${i + 1}/${assets.length}] Uploading to ImageKit...`);
//                 const tStart = Date.now();
//                 const task = BlobUtil.fetch(
//                   'POST',
//                   'https://upload.imagekit.io/api/v1/files/upload',
//                   {},
//                   uploadData,
//                 );
//                 task.uploadProgress((written, total) => {
//                   const pct =
//                     total > 0 ? Math.round((written / total) * 100) : 0;
//                   setProgress(pct);
//                 });

//                 const uploadResult = await task;
//                 const resultJson = uploadResult.json();
//                 const status = uploadResult.info().status;
//                 log('ImageKit upload HTTP status:', status);
//                 if (status >= 300)
//                   throw new Error(
//                     resultJson?.message || 'ImageKit upload failed',
//                   );

//                 uploadUrl = resultJson.url;
//                 storageType = 'imagekit';
//                 log(
//                   'ImageKit upload success:',
//                   uploadUrl,
//                   'timeMs:',
//                   Date.now() - tStart,
//                 );
//               } catch (e) {
//                 log(
//                   'ImageKit upload error, falling back to Cloudinary:',
//                   e?.message || e,
//                 );
//                 const fileBase64 = await BlobUtil.fs.readFile(
//                   (asset.uri || '').replace('file://', ''),
//                   'base64',
//                 );
//                 log('Uploading to Cloudinary...');
//                 const tStart = Date.now();
//                 const cloudRes = await fetch(
//                   'https://boyfriend-needs-backend.vercel.app/api/cloudinary-upload',
//                   {
//                     method: 'POST',
//                     headers: { 'Content-Type': 'application/json' },
//                     body: JSON.stringify({
//                       fileBase64: `data:${asset.type};base64,${fileBase64}`,
//                     }),
//                   },
//                 );
//                 const cloudJson = await cloudRes.json();
//                 if (!cloudJson.url) throw new Error('Cloudinary upload failed');
//                 uploadUrl = cloudJson.url;
//                 storageType = 'cloudinary';
//                 log(
//                   'Cloudinary upload success:',
//                   uploadUrl,
//                   'timeMs:',
//                   Date.now() - tStart,
//                 );
//               }
//             } else {
//               log('Directly uploading to Cloudinary (usage limit reached)...');
//               const fileBase64 = await BlobUtil.fs.readFile(
//                 (asset.uri || '').replace('file://', ''),
//                 'base64',
//               );
//               const tStart = Date.now();
//               const cloudRes = await fetch(
//                 'https://boyfriend-needs-backend.vercel.app/api/cloudinary-upload',
//                 {
//                   method: 'POST',
//                   headers: { 'Content-Type': 'application/json' },
//                   body: JSON.stringify({
//                     fileBase64: `data:${asset.type};base64,${fileBase64}`,
//                   }),
//                 },
//               );
//               const cloudJson = await cloudRes.json();
//               if (!cloudJson.url) throw new Error('Cloudinary upload failed');
//               uploadUrl = cloudJson.url;
//               storageType = 'cloudinary';
//               log(
//                 'Cloudinary upload success:',
//                 uploadUrl,
//                 'timeMs:',
//                 Date.now() - tStart,
//               );
//             }

//             // Insert row
//             log('Inserting row into Supabase images table...', {
//               user_id: user.id,
//               type,
//               storageType,
//               fileName: asset.fileName || '',
//               uploadUrl,
//             });

//             const { data: inserted, error: sErr } = await supabase
//               .from('images')
//               .insert({
//                 user_id: user.id,
//                 image_url: uploadUrl,
//                 storage_type: storageType,
//                 created_at: new Date().toISOString(),
//                 file_name: asset.fileName || '',
//                 favorite: false,
//                 type,
//                 private: false,
//               })
//               .select('*')
//               .single();

//             if (sErr || !inserted) {
//               log('Supabase insert error:', sErr, 'inserted:', inserted);
//               setErrorModal({
//                 visible: true,
//                 message: sErr?.message || 'Insert failed',
//               });
//               break;
//             }

//             log('Supabase insert success. Inserted row:', inserted);

//             // Edge Function: push notification for new item
//             try {
//               log(
//                 'Invoking edge function push-new-image-v1 with image_id:',
//                 inserted.id,
//                 'debug_notify_self:true',
//               );
//               const tFn = Date.now();
//               const { data: fnRes, error: fnErr } =
//                 await supabase.functions.invoke('push-new-image-v1', {
//                   body: { image_id: inserted.id, debug_notify_self: true },
//                 });
//               log('Function response:', fnRes, fnErr);
//               if (fnRes && fnRes.fcmResults) {
//                 log('FCM Results:', JSON.stringify(fnRes.fcmResults, null, 2));
//               }

//               const fnMs = Date.now() - tFn;

//               // Log the full function response, including fcmResults
//               log('Function response:', fnRes, fnErr);

//               if (fnErr) {
//                 log(
//                   'Edge function push-new-image-v1 ERROR:',
//                   fnErr,
//                   'durationMs:',
//                   fnMs,
//                 );
//               } else {
//                 log(
//                   'Edge function push-new-image-v1 OK. Response:',
//                   fnRes,
//                   'durationMs:',
//                   fnMs,
//                 );
//               }
//             } catch (fnCatch) {
//               log('Edge function invoke exception:', fnCatch);
//             }

//             successCount++;
//             log(
//               `[${i + 1}/${assets.length}] Completed upload+insert${
//                 isVideo ? ' (video)' : ' (photo)'
//               }. image_id:`,
//               inserted.id,
//             );
//           }

//           if (successCount > 0) {
//             setSuccessModal({
//               visible: true,
//               message: `${successCount} file(s) uploaded!`,
//             });
//             log('Refreshing images after uploads...');
//             fetchImages();
//           } else {
//             log('No successful uploads.');
//           }
//         } catch (e) {
//           log('Upload exception:', e);
//           setErrorModal({ visible: true, message: e.message || String(e) });
//         } finally {
//           setUploading(false);
//           setProgress(0);
//           log('Upload flow finished. uploading=false');
//         }
//       },
//     );
//   };

//   const onRefresh = () => {
//     setRefreshing(true);
//     log('Pull-to-refresh triggered.');
//     fetchImages();
//   };

//   // Open item (photo or video)
//   const openItem = item => {
//     log('Open item requested:', { id: item.id, type: item.type });
//     if (multiSelect) {
//       toggleSelect(item.id);
//       return;
//     }
//     if (item.type === 'video') {
//       if (videoSupportedRef.current) {
//         setVideoUri(item.image_url);
//         setVideoVisible(true);
//         log('Open video viewer for id:', item.id);
//       } else {
//         log('RCTVideo not available. Opening external player.');
//         Alert.alert(
//           'Opening externally',
//           'Native video module missing; opening in external player.',
//         );
//         Linking.openURL(item.image_url);
//       }
//     } else {
//       const idx = photosOnly.findIndex(p => p.id === item.id);
//       setPhotoViewerIndex(Math.max(0, idx));
//       setIsViewerVisible(true);
//       setShowFooter(true);
//       setShowComments(false);
//       log('Open photo viewer for id:', item.id, 'photoIndex:', idx);
//     }
//   };

//   // Single delete (from viewer footer)
//   const deleteCurrentPhoto = async () => {
//     const img = photosOnly[photoViewerIndex];
//     if (!img) return;
//     log('Delete current photo requested:', img.id);
//     Alert.alert('Delete', 'Delete this photo?', [
//       { text: 'Cancel', style: 'cancel' },
//       {
//         text: 'Delete',
//         style: 'destructive',
//         onPress: async () => {
//           const { error } = await supabase
//             .from('images')
//             .delete()
//             .eq('id', img.id);
//           if (error) {
//             setErrorModal({ visible: true, message: error.message });
//             log('Delete error:', error);
//           } else {
//             setIsViewerVisible(false);
//             fetchImages();
//             log('Deleted photo id:', img.id);
//           }
//         },
//       },
//     ]);
//   };

//   const handleShareCurrent = async () => {
//     try {
//       const img = photosOnly[photoViewerIndex];
//       if (!img) return;
//       await Share.open({ url: img.image_url });
//       log('Shared photo:', img.image_url);
//     } catch (e) {
//       log('Share error:', e);
//       setErrorModal({ visible: true, message: e.message });
//     }
//   };

//   const handleSaveCurrent = async () => {
//     try {
//       const img = photosOnly[photoViewerIndex];
//       if (!img) return;
//       const fileUrl = img.image_url;
//       const fileName = fileUrl.split('/').pop();
//       const dirs = BlobUtil.fs.dirs;
//       const dest =
//         Platform.OS === 'android'
//           ? `${dirs.DownloadDir}/${fileName}`
//           : `${dirs.DocumentDir}/${fileName}`;
//       log('Saving file to device...', { dest, fileUrl });
//       await BlobUtil.config({ path: dest }).fetch('GET', fileUrl);
//       setSuccessModal({ visible: true, message: 'Saved to device.' });
//       log('Saved file to:', dest);
//     } catch (e) {
//       log('Save error:', e);
//       setErrorModal({ visible: true, message: e.message });
//     }
//   };

//   const toggleFavoriteCurrent = async () => {
//     const img = photosOnly[photoViewerIndex];
//     if (!img) return;
//     try {
//       const updated = !img.favorite;
//       await supabase
//         .from('images')
//         .update({ favorite: updated })
//         .eq('id', img.id);
//       setImages(prev =>
//         prev.map(i => (i.id === img.id ? { ...i, favorite: updated } : i)),
//       );
//       log('Toggled favorite id:', img.id, '->', updated);
//     } catch (e) {
//       setErrorModal({ visible: true, message: e.message });
//       log('Toggle favorite error:', e);
//     }
//   };

//   // Multi-select helpers
//   const toggleSelect = id => {
//     setSelectedIds(prev =>
//       prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id],
//     );
//     log('Toggle select id:', id);
//   };

//   const startMultiSelect = id => {
//     if (!multiSelect) setMultiSelect(true);
//     toggleSelect(id);
//     log('Multi-select start/toggle id:', id);
//   };

//   const handleBatchDelete = async () => {
//     if (!selectedIds.length) return;
//     log('Batch delete requested count:', selectedIds.length);
//     Alert.alert('Delete', `Delete ${selectedIds.length} item(s)?`, [
//       { text: 'Cancel', style: 'cancel' },
//       {
//         text: 'Delete',
//         style: 'destructive',
//         onPress: async () => {
//           await supabase.from('images').delete().in('id', selectedIds);
//           setSelectedIds([]);
//           setMultiSelect(false);
//           fetchImages();
//           log('Batch deleted count:', selectedIds.length);
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
//       log('Batch share urls:', urls.length);
//     } catch (e) {
//       log('Batch share error/cancel:', e?.message || e);
//     }
//   };

//   const handleBatchFavoriteToggle = async () => {
//     if (!selectedIds.length) return;
//     try {
//       // If any is not favorite, set all to true; else set all to false
//       const selectedItems = images.filter(i => selectedIds.includes(i.id));
//       const makeFav = selectedItems.some(i => !i.favorite);
//       await supabase
//         .from('images')
//         .update({ favorite: makeFav })
//         .in('id', selectedIds);
//       setImages(prev =>
//         prev.map(i =>
//           selectedIds.includes(i.id) ? { ...i, favorite: makeFav } : i,
//         ),
//       );
//       log('Batch favorite ->', makeFav, 'count:', selectedIds.length);
//     } catch (e) {
//       setErrorModal({ visible: true, message: e.message });
//       log('Batch favorite error:', e);
//     }
//   };

//   const handleSelectAll = () => {
//     const ids = filteredImages.map(i => i.id);
//     setSelectedIds(ids);
//     setMultiSelect(true);
//     log('Selected all:', ids.length);
//   };

//   // Debug: send push for the latest image (notify self)
//   const debugSendPushForLatestImage = async () => {
//     try {
//       log('[Debug] Sending push for latest image (notify self)...');
//       const { data, error } = await supabase
//         .from('images')
//         .select('id')
//         .order('created_at', { ascending: false })
//         .limit(1);
//       if (error) throw error;
//       const latestId = data?.[0]?.id;
//       if (!latestId) {
//         Alert.alert(
//           'Debug Push',
//           'No images found. Upload an image or video first.',
//         );
//         return;
//       }
//       const tFn = Date.now();
//       const { data: fnRes, error: fnErr } = await supabase.functions.invoke(
//         'push-new-image-v1',
//         { body: { image_id: latestId, debug_notify_self: true } },
//       );
//       const ms = Date.now() - tFn;
//       if (fnErr) {
//         log('[Debug] push-new-image-v1 ERROR:', fnErr, 'ms:', ms);
//         Alert.alert(
//           'Debug Push',
//           'Function error. Open Supabase → Logs → Edge Functions.',
//         );
//       } else {
//         log('[Debug] push-new-image-v1 OK:', fnRes, 'ms:', ms);
//         Alert.alert('Debug Push', 'Invoked. Check your notifications.');
//       }
//     } catch (e) {
//       log('[Debug] Exception:', e);
//       Alert.alert('Debug Push', e?.message || String(e));
//     }
//   };

//   // Debug: log tokens for current user
//   const debugLogMyTokens = async () => {
//     try {
//       const {
//         data: { user },
//       } = await supabase.auth.getUser();
//       if (!user) {
//         log('[Debug] No user.');
//         Alert.alert('Tokens', 'No logged-in user.');
//         return;
//       }
//       const { data, error } = await supabase
//         .from('devices')
//         .select('token, platform, updated_at')
//         .eq('user_id', user.id);
//       if (error) {
//         log('[Debug] devices select error:', error);
//         Alert.alert('Tokens', error.message);
//         return;
//       }
//       log('[Debug] My tokens:', data);
//       Alert.alert(
//         'Tokens',
//         data?.length
//           ? `Found ${data.length} token(s) for your user. See console for details.`
//           : 'No tokens found for this user. Ensure App.js registers FCM token.',
//       );
//     } catch (e) {
//       log('[Debug] tokens exception:', e);
//     }
//   };

//   // Render each date section (show up to 4 and "See All" link)
//   const renderSection = (date, imagesArr) => {
//     const showSeeAll = imagesArr.length > 4;
//     const imagesToShow = showSeeAll ? imagesArr.slice(0, 4) : imagesArr;

//     return (
//       <Animated.View
//         key={date}
//         style={[
//           styles.section,
//           {
//             opacity: fadeAnim,
//             transform: [{ scale: scaleAnim }],
//           },
//         ]}
//       >
//         <LinearGradient
//           colors={[theme.colors.ultraLight, 'transparent']}
//           start={{ x: 0, y: 0 }}
//           end={{ x: 1, y: 0 }}
//           style={styles.sectionHeaderGradient}
//         >
//           <View style={styles.sectionHeader}>
//             <Text
//               style={[styles.sectionTitle, { color: theme.colors.primary }]}
//             >
//               {isToday(parseISO(date))
//                 ? '✨ Today'
//                 : format(parseISO(date), 'MMMM d, yyyy')}
//             </Text>
//             {showSeeAll && (
//               <TouchableOpacity
//                 onPress={() =>
//                   navigation.navigate('DayGallery', { date, images: imagesArr })
//                 }
//                 style={styles.seeAllButton}
//               >
//                 <LinearGradient
//                   colors={theme.gradient}
//                   start={{ x: 0, y: 0 }}
//                   end={{ x: 1, y: 0 }}
//                   style={styles.seeAllGradient}
//                 >
//                   <Text style={styles.seeAll}>See All</Text>
//                 </LinearGradient>
//               </TouchableOpacity>
//             )}
//           </View>
//         </LinearGradient>
//         <FlatList
//           data={imagesToShow}
//           numColumns={2}
//           keyExtractor={item => item.id.toString()}
//           renderItem={({ item }) => (
//             <PhotoGridItem
//               image={item}
//               onPress={() => openItem(item)}
//               onLongPress={() => startMultiSelect(item.id)}
//               selected={selectedIds.includes(item.id)}
//               showSelect={multiSelect}
//             />
//           )}
//           scrollEnabled={false}
//         />
//       </Animated.View>
//     );
//   };

//   // Loading UI
//   if (loading) {
//     return (
//       <LinearGradient colors={theme.gradient} style={styles.loader}>
//         <ActivityIndicator size="large" color="#FFFFFF" />
//         <Text style={styles.loadingText}>Loading your memories...</Text>
//       </LinearGradient>
//     );
//   }

//   // Main UI
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
//           <TouchableOpacity
//             onPress={() => navigation.navigate('Profile')}
//             style={styles.avatarContainer}
//           >
//             <LinearGradient
//               colors={theme.gradient}
//               style={styles.avatarGradient}
//             >
//               <Image
//                 source={
//                   avatarUrl
//                     ? { uri: avatarUrl }
//                     : require('../assets/default-avatar.jpg')
//                 }
//                 style={styles.avatar}
//               />
//             </LinearGradient>
//           </TouchableOpacity>

//           <LinearGradient
//             colors={theme.gradient}
//             start={{ x: 0, y: 0 }}
//             end={{ x: 1, y: 0 }}
//             style={styles.headerTitleContainer}
//           >
//             <Text style={styles.headerTitle}>Our Gallery 💕</Text>
//           </LinearGradient>

//           <Menu>
//             <MenuTrigger>
//               <View style={styles.menuTrigger}>
//                 <Icon name="sparkles" size={24} color={theme.colors.primary} />
//               </View>
//             </MenuTrigger>
//             <MenuOptions customStyles={menuOptionsStyles}>
//               <MenuOption
//                 onSelect={() => navigation.navigate('SharedCalendar')}
//               >
//                 <View style={styles.menuOptionContainer}>
//                   <Icon name="calendar" size={20} color={theme.shared.purple} />
//                   <Text style={styles.menuOption}>Shared Calendar</Text>
//                 </View>
//               </MenuOption>
//               <MenuOption onSelect={() => navigation.navigate('PrivateChat')}>
//                 <View style={styles.menuOptionContainer}>
//                   <Icon
//                     name="chatbubbles"
//                     size={20}
//                     color={theme.shared.orange}
//                   />
//                   <Text style={styles.menuOption}>Private Chat</Text>
//                 </View>
//               </MenuOption>
//               <MenuOption onSelect={() => navigation.navigate('PhotoVault')}>
//                 <View style={styles.menuOptionContainer}>
//                   <Icon
//                     name="lock-closed"
//                     size={20}
//                     color={theme.shared.gold}
//                   />
//                   <Text style={styles.menuOption}>Photo Vault</Text>
//                 </View>
//               </MenuOption>

//               {/* Debug items */}
//               <MenuOption onSelect={debugSendPushForLatestImage}>
//                 <View style={styles.menuOptionContainer}>
//                   <Icon
//                     name="notifications"
//                     size={20}
//                     color={theme.shared.green}
//                   />
//                   <Text style={styles.menuOption}>Test Push (notify me)</Text>
//                 </View>
//               </MenuOption>
//               <MenuOption onSelect={debugLogMyTokens}>
//                 <View style={styles.menuOptionContainer}>
//                   <Icon
//                     name="phone-portrait"
//                     size={20}
//                     color={theme.shared.yellow}
//                   />
//                   <Text style={styles.menuOption}>Log my device tokens</Text>
//                 </View>
//               </MenuOption>

//               <MenuOption
//                 onSelect={async () => {
//                   await supabase.auth.signOut();
//                   navigation.reset({
//                     index: 0,
//                     routes: [{ name: 'ProfileSelector' }],
//                   });
//                 }}
//               >
//                 <View style={styles.menuOptionContainer}>
//                   <Icon name="log-out" size={20} color={theme.shared.red} />
//                   <Text
//                     style={[styles.menuOption, { color: theme.shared.red }]}
//                   >
//                     Sign Out
//                   </Text>
//                 </View>
//               </MenuOption>
//             </MenuOptions>
//           </Menu>
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
//                   onPress={handleBatchFavoriteToggle}
//                   style={styles.multiSelectButton}
//                 >
//                   <Icon name="heart" size={22} color={theme.shared.red} />
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

//         {/* Search + Filter + toggle */}
//         <Animated.View
//           style={[
//             styles.searchBar,
//             {
//               opacity: fadeAnim,
//               transform: [{ scale: scaleAnim }],
//             },
//           ]}
//         >
//           <LinearGradient
//             colors={['#FFFFFF', theme.colors.ultraLight]}
//             style={styles.searchGradient}
//           >
//             <Icon name="search" size={20} color={theme.colors.primary} />
//             <TextInput
//               style={[styles.searchInput, { color: theme.text }]}
//               placeholder="Search memories..."
//               placeholderTextColor={theme.gray.medium}
//               value={search}
//               onChangeText={t => {
//                 setSearch(t);
//                 log('Search changed:', t);
//               }}
//             />
//             <TouchableOpacity
//               onPress={() => setShowFilterDropdown(v => !v)}
//               style={styles.filterButton}
//             >
//               <LinearGradient
//                 colors={theme.gradient}
//                 style={styles.filterGradient}
//               >
//                 <Icon name="options" size={20} color="#FFFFFF" />
//               </LinearGradient>
//             </TouchableOpacity>
//             <TouchableOpacity
//               onPress={() => setMultiSelect(v => !v)}
//               style={styles.selectButton}
//             >
//               <Icon
//                 name={multiSelect ? 'checkbox' : 'checkbox-outline'}
//                 size={24}
//                 color={theme.colors.primary}
//               />
//             </TouchableOpacity>
//           </LinearGradient>
//         </Animated.View>

//         {/* Filter Dropdown */}
//         {showFilterDropdown && (
//           <Animated.View
//             style={[
//               styles.dropdown,
//               {
//                 opacity: fadeAnim,
//                 transform: [{ scale: scaleAnim }],
//               },
//             ]}
//           >
//             {FILTERS.map(f => (
//               <TouchableOpacity
//                 key={f.value}
//                 style={[
//                   styles.dropdownItem,
//                   filter === f.value && styles.dropdownItemActive,
//                 ]}
//                 onPress={() => {
//                   setFilter(f.value);
//                   setShowFilterDropdown(false);
//                   log('Filter set to:', f.value);
//                 }}
//               >
//                 <Icon
//                   name={f.icon}
//                   size={18}
//                   color={filter === f.value ? f.color : theme.gray.dark}
//                 />
//                 <Text
//                   style={[
//                     styles.dropdownText,
//                     {
//                       color: filter === f.value ? f.color : theme.gray.dark,
//                       fontWeight: filter === f.value ? 'bold' : 'normal',
//                     },
//                   ]}
//                 >
//                   {f.label}
//                 </Text>
//               </TouchableOpacity>
//             ))}
//           </Animated.View>
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
//             <Icon name="add" size={32} color="#FFFFFF" />
//           </LinearGradient>
//         </TouchableOpacity>

//         {/* Upload Progress */}
//         {uploading && (
//           <Animated.View
//             style={[
//               styles.uploadStatus,
//               {
//                 opacity: fadeAnim,
//               },
//             ]}
//           >
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

//         {/* Photo Viewer */}
//         <ImageViewing
//           images={photosOnly.map(img => ({ uri: img.image_url }))}
//           imageIndex={photoViewerIndex}
//           visible={isViewerVisible}
//           onRequestClose={() => setIsViewerVisible(false)}
//           doubleTapToZoomEnabled
//           swipeToCloseEnabled
//           onImageIndexChange={() => {
//             setShowFooter(true);
//             setShowComments(false);
//           }}
//           imageContainerStyle={{ marginBottom: showFooter ? 180 : 0 }}
//           FooterComponent={() => {
//             const img = photosOnly[photoViewerIndex];
//             if (!img) return null;
//             return (
//               <View>
//                 <LinearGradient
//                   colors={['transparent', 'rgba(0,0,0,0.8)']}
//                   style={styles.viewerFooter}
//                 >
//                   <TouchableOpacity
//                     style={styles.viewerButton}
//                     onPress={handleShareCurrent}
//                   >
//                     <Icon name="share-social" size={24} color="#FFFFFF" />
//                   </TouchableOpacity>
//                   <TouchableOpacity
//                     style={styles.viewerButton}
//                     onPress={handleSaveCurrent}
//                   >
//                     <Icon name="download" size={24} color="#FFFFFF" />
//                   </TouchableOpacity>
//                   <TouchableOpacity
//                     style={styles.viewerButton}
//                     onPress={toggleFavoriteCurrent}
//                   >
//                     <Icon
//                       name={img.favorite ? 'heart' : 'heart-outline'}
//                       size={24}
//                       color={theme.shared.red}
//                     />
//                   </TouchableOpacity>
//                   <TouchableOpacity
//                     style={styles.viewerButton}
//                     onPress={deleteCurrentPhoto}
//                   >
//                     <Icon name="trash" size={24} color={theme.shared.red} />
//                   </TouchableOpacity>
//                   <TouchableOpacity
//                     style={styles.viewerButton}
//                     onPress={() => setShowComments(v => !v)}
//                   >
//                     <Icon
//                       name="chatbubble-ellipses"
//                       size={24}
//                       color="#FFFFFF"
//                     />
//                   </TouchableOpacity>
//                 </LinearGradient>
//                 {showComments && (
//                   <CommentsSection
//                     imageId={img.id}
//                     userId={userId}
//                     theme={theme}
//                   />
//                 )}
//               </View>
//             );
//           }}
//         />

//         {/* Video Viewer (dedicated) */}
//         <Modal
//           isVisible={videoVisible}
//           onBackdropPress={() => setVideoVisible(false)}
//           onBackButtonPress={() => setVideoVisible(false)}
//           style={{ margin: 0 }}
//           useNativeDriver
//           hideModalContentWhileAnimating
//         >
//           <View style={{ flex: 1, backgroundColor: '#000' }}>
//             <Video
//               source={{ uri: videoUri }}
//               style={{ width: '100%', height: '100%' }}
//               controls
//               paused={false}
//               resizeMode="contain"
//               onError={e => log('Video error:', e)}
//               onLoad={meta => log('Video loaded duration:', meta.duration)}
//               posterResizeMode="cover"
//             />
//             <TouchableOpacity
//               onPress={() => setVideoVisible(false)}
//               style={styles.videoCloseButton}
//             >
//               <LinearGradient
//                 colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,0.8)']}
//                 style={styles.videoCloseGradient}
//               >
//                 <Icon name="close" size={24} color="#FFFFFF" />
//               </LinearGradient>
//             </TouchableOpacity>
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

// // Enhanced Styles
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
//     paddingVertical: 12,
//     justifyContent: 'space-between',
//   },
//   avatarContainer: {
//     marginRight: 12,
//   },
//   avatarGradient: {
//     width: 44,
//     height: 44,
//     borderRadius: 22,
//     padding: 2,
//     elevation: 4,
//     shadowColor: '#000',
//     shadowOpacity: 0.2,
//     shadowRadius: 4,
//     shadowOffset: { width: 0, height: 2 },
//   },
//   avatar: {
//     width: 40,
//     height: 40,
//     borderRadius: 20,
//     backgroundColor: '#FFF',
//   },
//   headerTitleContainer: {
//     flex: 1,
//     paddingVertical: 8,
//     paddingHorizontal: 16,
//     borderRadius: 20,
//     marginRight: 12,
//   },
//   headerTitle: {
//     fontSize: 20,
//     fontWeight: 'bold',
//     color: '#FFFFFF',
//     textAlign: 'center',
//   },
//   menuTrigger: {
//     padding: 8,
//     borderRadius: 20,
//     backgroundColor: 'rgba(255,255,255,0.9)',
//     elevation: 2,
//   },
//   menuOptionContainer: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     padding: 12,
//   },
//   menuOption: {
//     fontSize: 16,
//     marginLeft: 12,
//     color: '#222',
//     fontWeight: '500',
//   },

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
//   filterButton: {
//     marginLeft: 8,
//   },
//   filterGradient: {
//     width: 36,
//     height: 36,
//     borderRadius: 18,
//     justifyContent: 'center',
//     alignItems: 'center',
//   },
//   selectButton: {
//     marginLeft: 12,
//   },

//   section: {
//     marginBottom: 24,
//     marginHorizontal: 16,
//   },
//   sectionHeaderGradient: {
//     borderRadius: 12,
//     marginBottom: 12,
//   },
//   sectionHeader: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     alignItems: 'center',
//     paddingVertical: 8,
//     paddingHorizontal: 12,
//   },
//   sectionTitle: {
//     fontSize: 18,
//     fontWeight: 'bold',
//   },
//   seeAllButton: {
//     borderRadius: 16,
//   },
//   seeAllGradient: {
//     paddingHorizontal: 16,
//     paddingVertical: 6,
//     borderRadius: 16,
//   },
//   seeAll: {
//     color: '#FFFFFF',
//     fontWeight: 'bold',
//     fontSize: 14,
//   },

//   fab: {
//     position: 'absolute',
//     right: 24,
//     bottom: 100,
//     zIndex: 10,
//   },
//   fabGradient: {
//     width: 64,
//     height: 64,
//     borderRadius: 32,
//     justifyContent: 'center',
//     alignItems: 'center',
//     elevation: 8,
//     shadowColor: '#000',
//     shadowOpacity: 0.3,
//     shadowRadius: 8,
//     shadowOffset: { width: 0, height: 4 },
//   },

//   uploadStatus: {
//     position: 'absolute',
//     bottom: 160,
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
//     paddingVertical: 12,
//     paddingHorizontal: 16,
//     borderRadius: 25,
//     marginHorizontal: 4,
//     backdropFilter: 'blur(10px)',
//   },

//   dropdown: {
//     position: 'absolute',
//     top: 140,
//     right: 16,
//     zIndex: 10,
//     backgroundColor: '#FFFFFF',
//     borderRadius: 16,
//     elevation: 8,
//     shadowColor: '#000',
//     shadowOpacity: 0.15,
//     shadowRadius: 8,
//     shadowOffset: { width: 0, height: 4 },
//     minWidth: 180,
//     padding: 8,
//   },
//   dropdownItem: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     padding: 12,
//     borderRadius: 12,
//     marginVertical: 2,
//   },
//   dropdownItemActive: {
//     backgroundColor: 'rgba(102, 126, 234, 0.1)',
//   },
//   dropdownText: {
//     marginLeft: 12,
//     fontSize: 15,
//   },

//   videoCloseButton: {
//     position: 'absolute',
//     top: 40,
//     right: 20,
//   },
//   videoCloseGradient: {
//     width: 40,
//     height: 40,
//     borderRadius: 20,
//     justifyContent: 'center',
//     alignItems: 'center',
//   },
// });

// const menuOptionsStyles = {
//   optionsContainer: {
//     backgroundColor: 'white',
//     borderRadius: 16,
//     padding: 8,
//     elevation: 8,
//     shadowColor: '#000',
//     shadowOpacity: 0.15,
//     shadowRadius: 8,
//     shadowOffset: { width: 0, height: 4 },
//     marginTop: 40,
//     marginRight: 16,
//   },
// };

// export default GalleryScreen;
