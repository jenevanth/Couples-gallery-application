// screens/GalleryScreen.js
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

// Cloudinary unsigned fallback (no secrets on client)
const CLOUDINARY_CLOUD_NAME = 'djl0ig55b';
const CLOUDINARY_UNSIGNED_PRESET = 'ourmoments_upload';

// Filter options
const FILTERS = [
  { label: 'All', value: 'all', icon: 'albums', color: '#667EEA' },
  { label: 'Photos', value: 'photo', icon: 'image', color: '#FF6B9D' },
  { label: 'Videos', value: 'video', icon: 'videocam', color: '#06FFA5' },
  { label: 'Favorites', value: 'favorites', icon: 'heart', color: '#E63946' },
  { label: 'This Month', value: 'month', icon: 'calendar', color: '#FFD60A' },
  { label: 'This Week', value: 'week', icon: 'today', color: '#00D4FF' },
];

// Reactions + slideshow durations
const REACTIONS = ['❤️', '😍', '🔥', '💕', '✨', '😊'];
const SLIDESHOW_DURATIONS = [
  { label: '3 sec', value: 3000 },
  { label: '5 sec', value: 5000 },
  { label: '10 sec', value: 10000 },
  { label: '15 sec', value: 15000 },
];

const { width } = Dimensions.get('window');

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
  const [householdId, setHouseholdId] = useState(null);

  // UI
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  // Search & Filter
  theme;
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);

  // Viewer
  const [isViewerVisible, setIsViewerVisible] = useState(false);
  const [viewerStartIndex, setViewerStartIndex] = useState(0);
  const [showPhotoInfo, setShowPhotoInfo] = useState(false);

  // Slideshow
  const [slideshowActive, setSlideshowActive] = useState(false);
  const [slideshowDuration, setSlideshowDuration] = useState(5000);
  const [secondsModalVisible, setSecondsModalVisible] = useState(false);
  const [secondsDraft, setSecondsDraft] = useState(5);
  const slideshowTimer = useRef(null);
  const pausedByUserSwipeRef = useRef(false);
  const swipeResumeTimeoutRef = useRef(null);

  // Video
  const [videoVisible, setVideoVisible] = useState(false);
  const [videoUri, setVideoUri] = useState('');
  const videoSupportedRef = useRef(false);
  const resumeSlideshowAfterVideoRef = useRef(false);
  const currentViewerIndexRef = useRef(0);

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

  // Freeze viewer sources while open
  const [viewerFrozenSources, setViewerFrozenSources] = useState([]);

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
  }, [fadeAnim, scaleAnim]);

  // Detect RCTVideo
  useEffect(() => {
    try {
      const cfg = UIManager.getViewManagerConfig
        ? UIManager.getViewManagerConfig('RCTVideo')
        : UIManager.RCTVideo;
      log('RCTVideo available:', !!cfg);
      videoSupportedRef.current = !!cfg;
    } catch (e) {
      log('RCTVideo VM lookup error:', e);
      videoSupportedRef.current = false;
    }
  }, []);

  // Load profile
  const fetchProfile = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      const { data } = await supabase
        .from('profiles')
        .select('avatar_url, username, household_id')
        .eq('id', user.id)
        .maybeSingle();
      setAvatarUrl(data?.avatar_url || '');
      setUserName(data?.username || 'User');
      setHouseholdId(data?.household_id || null);
      log('Loaded profile:', {
        avatar: data?.avatar_url,
        username: data?.username,
        hh: data?.household_id,
      });
    } catch {}
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);
  useFocusEffect(
    useCallback(() => {
      fetchProfile();
    }, [fetchProfile]),
  );

  // Fetch images (public only)
  const fetchImages = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('images')
        .select('*')
        .eq('private', false)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setImages(data || []);
    } catch (e) {
      setErrorModal({ visible: true, message: e.message || String(e) });
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
      const byImage = {};
      reactions?.forEach(r => {
        if (!byImage[r.image_id]) byImage[r.image_id] = [];
        byImage[r.image_id].push(r);
      });
      setImageReactions(byImage);
    } catch {}
  }, []);

  // Realtime
  useEffect(() => {
    fetchImages();
    fetchReactions();

    const ch = supabase
      .channel('public:images')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'images' },
        () => fetchImages(),
      )
      .subscribe();

    const reactionsCh = supabase
      .channel('public:reactions')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reactions' },
        () => fetchReactions(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
      supabase.removeChannel(reactionsCh);
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

  // Filters -> filtered list
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

  const groupedImages = useMemo(
    () => groupImagesByDate(filteredImages),
    [filteredImages, groupImagesByDate],
  );

  // Viewer: photos only (match DayGallery)
  const viewerItems = useMemo(
    () => filteredImages.filter(m => m.type !== 'video'),
    [filteredImages],
  );
  const viewerSources = useMemo(
    () => viewerItems.map(img => ({ uri: img.image_url })),
    [viewerItems],
  );

  // No prefetch (avoid Android bitmap pool pressure)
  const prefetchNeighbors = useCallback(() => {}, []);

  // Robust video upload helper (server-first, then unsigned Cloudinary via FormData)
  const uploadVideoWithFallback = useCallback(async asset => {
    // 1) Try your server route (base64 -> server -> Cloudinary)
    try {
      const localPath = (asset.uri || '').replace('file://', '');
      const base64 = await BlobUtil.fs.readFile(localPath, 'base64');

      const res = await fetch(
        'https://boyfriend-needs-backend.vercel.app/api/cloudinary-upload',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileBase64: `data:${asset.type};base64,${base64}`,
          }),
        },
      );

      const contentType = res.headers.get('content-type') || '';
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Server ${res.status}: ${text.slice(0, 300)}`);
      }

      if (contentType.includes('application/json')) {
        const json = await res.json();
        if (!json?.url) {
          throw new Error(
            'Cloudinary upload failed (video): missing url in server response',
          );
        }
        return { url: json.url, storage: 'cloudinary' };
      } else {
        const text = await res.text();
        throw new Error(`Server responded non-JSON: ${text.slice(0, 300)}`);
      }
    } catch (err) {
      log('[Upload][Video] Server route failed:', err?.message || err);
    }

    // 2) Direct unsigned upload to Cloudinary using FormData (matches Postman)
    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UNSIGNED_PRESET) {
      throw new Error(
        'Video upload failed on server. Set CLOUDINARY_CLOUD_NAME and CLOUDINARY_UNSIGNED_PRESET for direct fallback.',
      );
    }

    try {
      const fileName = asset.fileName || `video_${Date.now()}.mp4`;
      const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`;

      const formData = new FormData();
      formData.append('file', {
        uri: asset.uri,
        type: asset.type || 'video/mp4',
        name: fileName,
      });
      formData.append('upload_preset', CLOUDINARY_UNSIGNED_PRESET);
      // Optional folder:
      // formData.append('folder', 'ourmoments');

      // Do NOT set Content-Type header; let fetch set boundary
      const res = await fetch(uploadUrl, { method: 'POST', body: formData });

      const text = await res.text();
      if (!res.ok)
        throw new Error(
          `Cloudinary direct upload ${res.status}: ${text.slice(0, 300)}`,
        );

      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`Cloudinary returned non-JSON: ${text.slice(0, 300)}`);
      }

      if (!json?.secure_url && !json?.url) {
        throw new Error('Cloudinary direct upload ok but missing secure_url.');
      }
      return { url: json.secure_url || json.url, storage: 'cloudinary' };
    } catch (err2) {
      log(
        '[Upload][Video] Direct Cloudinary fallback failed:',
        err2?.message || err2,
      );
      throw err2;
    }
  }, []);

  // Upload (photos + videos)
  const handleImagePickAndUpload = () => {
    log('Launching image library picker...');
    launchImageLibrary(
      { mediaType: 'mixed', selectionLimit: 0 },
      async response => {
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

          // ImageKit usage (photos)
          const usageRes = await fetch(
            'https://boyfriend-needs-backend.vercel.app/api/imagekit-usage',
          );
          const usage = await usageRes.json();
          const useImageKit = usage?.totalGB < IMAGEKIT_LIMIT_GB;

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
            const isVideo = asset.type?.startsWith('video');
            const type = isVideo ? 'video' : 'photo';
            let uploadUrl = '';
            let storageType = '';

            if (isVideo) {
              // Video: server-first, then direct unsigned fallback
              try {
                const out = await uploadVideoWithFallback(asset);
                uploadUrl = out.url;
                storageType = out.storage;
                log('Video upload success:', uploadUrl);
              } catch (e) {
                setErrorModal({
                  visible: true,
                  message: e?.message || 'Video upload failed',
                });
                break;
              }
            } else {
              // Photo: ImageKit -> fallback to Cloudinary through your server
              try {
                if (useImageKit) {
                  const signatureData = await fetch(
                    'https://boyfriend-needs-backend.vercel.app/api/imagekit-auth',
                  ).then(res => res.json());
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
                  const task = BlobUtil.fetch(
                    'POST',
                    'https://upload.imagekit.io/api/v1/files/upload',
                    {},
                    uploadData,
                  );
                  task.uploadProgress((written, total) => {
                    if (total > 0)
                      setProgress(Math.round((written / total) * 100));
                  });
                  const uploadResult = await task;
                  const resultJson = uploadResult.json();
                  const status = uploadResult.info().status;
                  if (status >= 300)
                    throw new Error(
                      resultJson?.message || 'ImageKit upload failed',
                    );
                  uploadUrl = resultJson.url;
                  storageType = 'imagekit';
                } else {
                  const fileBase64 = await BlobUtil.fs.readFile(
                    (asset.uri || '').replace('file://', ''),
                    'base64',
                  );
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
                  const contentType =
                    cloudRes.headers.get('content-type') || '';
                  if (!cloudRes.ok) {
                    const txt = await cloudRes.text();
                    throw new Error(
                      `Cloudinary (photo) server ${
                        cloudRes.status
                      }: ${txt.slice(0, 300)}`,
                    );
                  }
                  const cloudJson = contentType.includes('application/json')
                    ? await cloudRes.json()
                    : JSON.parse(await cloudRes.text());
                  if (!cloudJson.url)
                    throw new Error('Cloudinary upload failed (photo)');
                  uploadUrl = cloudJson.url;
                  storageType = 'cloudinary';
                }
              } catch (e) {
                setErrorModal({
                  visible: true,
                  message: e?.message || 'Photo upload failed',
                });
                break;
              }
            }

            // Insert into Supabase
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
                household_id: householdId,
              })
              .select('*')
              .single();
            if (sErr || !inserted) {
              setErrorModal({
                visible: true,
                message: sErr?.message || 'Insert failed',
              });
              break;
            }

            try {
              await supabase.functions.invoke('push-new-image-v1', {
                body: { image_id: inserted.id, include_sender: true },
              });
            } catch {}

            successCount++;
          }

          if (successCount > 0) {
            setSuccessModal({
              visible: true,
              message: `${successCount} file(s) uploaded!`,
            });
            fetchImages();
          }
        } catch (e) {
          setErrorModal({ visible: true, message: e.message || String(e) });
        } finally {
          setUploading(false);
          setProgress(0);
        }
      },
    );
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchImages();
    fetchReactions();
  };

  // Open item
  const openItem = item => {
    if (multiSelect) {
      toggleSelect(item.id);
      return;
    }

    if (item.type !== 'video') {
      const idx = viewerItems.findIndex(p => p.id === item.id);
      setViewerStartIndex(Math.max(0, idx));
      currentViewerIndexRef.current = Math.max(0, idx);
      setShowReactions(false);
      setShowPhotoInfo(false);
      setViewerFrozenSources(viewerSources);
      setIsViewerVisible(true);
      prefetchNeighbors(idx);
      return;
    }

    if (videoSupportedRef.current) {
      setVideoUri(item.image_url);
      setVideoVisible(true);
    } else {
      Alert.alert(
        'Opening externally',
        'Native video module missing; opening in external player.',
      );
      Linking.openURL(item.image_url);
    }
  };

  const openVideoFromViewer = url => {
    if (slideshowActive) {
      clearInterval(slideshowTimer.current);
      slideshowTimer.current = null;
      setSlideshowActive(false);
      resumeSlideshowAfterVideoRef.current = true;
    } else {
      resumeSlideshowAfterVideoRef.current = false;
    }
    setVideoUri(url);
    setVideoVisible(true);
  };

  const closeVideoModal = () => {
    setVideoVisible(false);
    if (resumeSlideshowAfterVideoRef.current) {
      resumeSlideshowAfterVideoRef.current = false;
      setSlideshowActive(true);
      startSlideshowTimer();
    }
  };

  // Share (binary)
  const handleShareCurrent = async (currentUrl, isVideo) => {
    try {
      const url = currentUrl;
      const defaultExt = isVideo ? 'mp4' : 'jpg';
      const cleanUrl = url.split('?')[0];
      const extFromUrl = cleanUrl.includes('.')
        ? cleanUrl.split('.').pop()
        : defaultExt;
      const ext =
        (extFromUrl || defaultExt).toLowerCase().replace(/[^a-z0-9]/gi, '') ||
        defaultExt;

      const cachePath = `${
        BlobUtil.fs.dirs.CacheDir
      }/share_${Date.now()}.${ext}`;
      await BlobUtil.config({ path: cachePath, fileCache: true }).fetch(
        'GET',
        url,
      );
      const fileUrl = `file://${cachePath}`;
      const mime = isVideo
        ? 'video/mp4'
        : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      await Share.open({ url: fileUrl, type: mime, failOnCancel: false });
    } catch (e) {
      try {
        await Share.open({ url: currentUrl, failOnCancel: false });
      } catch (e2) {
        if (e2?.message !== 'User did not share') {
          setErrorModal({
            visible: true,
            message: e2.message || 'Share failed',
          });
        }
      }
    }
  };

  // Save file
  const handleSaveCurrent = async item => {
    try {
      if (!item) return;
      if (item.type === 'video') {
        Alert.alert(
          'Open Video',
          'Use the video player to download/share the video.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Open',
              onPress: () => openVideoFromViewer(item.image_url),
            },
          ],
        );
        return;
      }

      if (Platform.OS === 'android') {
        try {
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
        } catch {}
      }

      const fileUrl = item.image_url;
      const fileName =
        item.file_name || fileUrl.split('/').pop() || `image_${Date.now()}.jpg`;
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
  const toggleFavoriteItem = async item => {
    if (!item || item.type === 'video') return;
    try {
      const updated = !item.favorite;
      await supabase
        .from('images')
        .update({ favorite: updated })
        .eq('id', item.id);
      setImages(prev =>
        prev.map(i => (i.id === item.id ? { ...i, favorite: updated } : i)),
      );
    } catch (e) {
      setErrorModal({ visible: true, message: e.message });
    }
  };

  // Toggle reaction
  const toggleReactionForItem = async (emoji, item) => {
    if (!item || item.type === 'video') return;
    try {
      const existing = imageReactions[item.id] || [];
      const userReaction = existing.find(
        r => r.user_id === userId && r.emoji === emoji,
      );
      if (userReaction) {
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
      setErrorModal({ visible: true, message: 'Failed to update reaction' });
    }
  };

  // Slideshow control
  const startSlideshowTimer = () => {
    if (slideshowTimer.current) clearInterval(slideshowTimer.current);
    if (!isViewerVisible) return;
    const total =
      (viewerFrozenSources.length
        ? viewerFrozenSources.length
        : viewerItems.length) || 0;
    if (total <= 1) return;
    slideshowTimer.current = setInterval(() => {
      const next = (currentViewerIndexRef.current + 1) % total;
      currentViewerIndexRef.current = next;
      setViewerStartIndex(next);
    }, slideshowDuration);
  };

  const stopSlideshowTimer = () => {
    if (slideshowTimer.current) {
      clearInterval(slideshowTimer.current);
      slideshowTimer.current = null;
    }
  };

  const confirmSlideshowSeconds = () => {
    const ms = Math.max(1, Math.min(30, secondsDraft)) * 1000;
    setSecondsModalVisible(false);
    setSlideshowDuration(ms);
    setSlideshowActive(true);
    startSlideshowTimer();
  };

  useEffect(() => {
    if (slideshowActive) startSlideshowTimer();
  }, [slideshowActive, slideshowDuration, isViewerVisible]);

  useEffect(() => {
    return () => {
      stopSlideshowTimer();
      if (swipeResumeTimeoutRef.current)
        clearTimeout(swipeResumeTimeoutRef.current);
    };
  }, []);

  // Multi-select
  const toggleSelect = id =>
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id],
    );
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
          fetchImages();
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
      const paths = [];
      for (const url of urls) {
        try {
          const clean = url.split('?')[0];
          const ext = clean.includes('.') ? clean.split('.').pop() : 'jpg';
          const path = `${
            BlobUtil.fs.dirs.CacheDir
          }/share_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
          await BlobUtil.config({ path, fileCache: true }).fetch('GET', url);
          paths.push(`file://${path}`);
        } catch (e) {}
      }
      if (paths.length) await Share.open({ urls: paths, failOnCancel: false });
      else await Share.open({ urls, failOnCancel: false });
    } catch {}
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
    } catch (e) {
      setErrorModal({ visible: true, message: e.message });
    }
  };
  const handleSelectAll = () => {
    const ids = filteredImages.map(i => i.id);
    setSelectedIds(ids);
    setMultiSelect(true);
  };

  // Render section
  const renderSection = (date, imagesArr) => {
    const showSeeAll = imagesArr.length > 4;
    const imagesToShow = showSeeAll ? imagesArr.slice(0, 4) : imagesArr;
    return (
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
              suspend={isViewerVisible} // free memory while viewer open
            />
          )}
          scrollEnabled={false}
        />
      </Animated.View>
    );
  };

  // Viewer header
  const ViewerHeader = () => {
    return (
      <LinearGradient
        colors={['rgba(0,0,0,0.7)', 'transparent']}
        style={styles.viewerHeader}
      >
        <TouchableOpacity
          onPress={() => {
            setIsViewerVisible(false);
            setViewerFrozenSources([]);
            if (slideshowActive) {
              stopSlideshowTimer();
              setSlideshowActive(false);
            }
          }}
          style={styles.viewerCloseButton}
        >
          <Icon name="close" size={28} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.viewerHeaderActions}>
          <TouchableOpacity
            onPress={() =>
              slideshowActive
                ? (stopSlideshowTimer(), setSlideshowActive(false))
                : setSecondsModalVisible(true)
            }
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
    );
  };

  // Viewer footer
  const ViewerFooter = ({ imageIndex }) => {
    const item = viewerItems[imageIndex];
    if (!item) return null;
    const reactions = imageReactions[item.id] || [];
    return (
      <View pointerEvents="box-none">
        {showPhotoInfo && (
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.9)']}
            style={styles.photoInfoPanel}
          >
            <Text style={styles.photoInfoTitle}>Photo Details</Text>
            <Text style={styles.photoInfoText}>
              Name: {item.file_name || 'Untitled'}
            </Text>
            <Text style={styles.photoInfoText}>
              Date: {format(parseISO(item.created_at), 'PPpp')}
            </Text>
            <Text style={styles.photoInfoText}>
              Storage: {item.storage_type}
            </Text>
            <Text style={styles.photoInfoText}>Type: {item.type}</Text>
          </LinearGradient>
        )}

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

        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.8)']}
          style={styles.viewerFooter}
        >
          <TouchableOpacity
            style={styles.viewerButton}
            onPress={() => handleShareCurrent(item.image_url, false)}
          >
            <Icon name="share-social" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.viewerButton}
            onPress={() => handleSaveCurrent(item)}
          >
            <Icon name="download" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.viewerButton}
            onPress={() => toggleFavoriteItem(item)}
          >
            <Icon
              name={item.favorite ? 'heart' : 'heart-outline'}
              size={24}
              color={item.favorite ? theme.shared?.red || '#FF5252' : '#FFFFFF'}
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
            onPress={() =>
              Alert.alert('Delete', 'Delete this photo?', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: async () => {
                    const { error } = await supabase
                      .from('images')
                      .delete()
                      .eq('id', item.id);
                    if (error)
                      setErrorModal({
                        visible: true,
                        message: error.message,
                      });
                    else {
                      setIsViewerVisible(false);
                      setViewerFrozenSources([]);
                      fetchImages();
                    }
                  },
                },
              ])
            }
          >
            <Icon
              name="trash"
              size={24}
              color={theme.shared?.red || '#FF5252'}
            />
          </TouchableOpacity>
        </LinearGradient>
      </View>
    );
  };

  // Loading
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

        {/* Search + Filter */}
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
              placeholder="Search memories..."
              placeholderTextColor={theme.colors.primary + '60'}
              value={search}
              onChangeText={setSearch}
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
              { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
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

        {/* Black backdrop under viewer */}
        {isViewerVisible && (
          <View pointerEvents="none" style={styles.viewerBackdrop} />
        )}

        {/* Media Viewer (photos only) */}
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
              stopSlideshowTimer();
              setSlideshowActive(false);
            }
          }}
          doubleTapToZoomEnabled
          swipeToCloseEnabled
          onImageIndexChange={idx => {
            currentViewerIndexRef.current = idx;
            setShowReactions(false);
            setShowPhotoInfo(false);

            if (slideshowActive) {
              pausedByUserSwipeRef.current = true;
              stopSlideshowTimer();
              setSlideshowActive(false);
              if (swipeResumeTimeoutRef.current)
                clearTimeout(swipeResumeTimeoutRef.current);
              swipeResumeTimeoutRef.current = setTimeout(() => {
                if (pausedByUserSwipeRef.current) {
                  pausedByUserSwipeRef.current = false;
                  setSlideshowActive(true);
                  startSlideshowTimer();
                }
              }, 600);
            }
          }}
          HeaderComponent={ViewerHeader}
          FooterComponent={ViewerFooter}
        />

        {/* Slideshow seconds modal */}
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
              {SLIDESHOW_DURATIONS.map(d => (
                <TouchableOpacity
                  key={d.value}
                  style={[
                    styles.secondsChip,
                    secondsDraft === d.value / 1000 && styles.secondsChipActive,
                  ]}
                  onPress={() => setSecondsDraft(d.value / 1000)}
                >
                  <Text
                    style={[
                      styles.secondsChipText,
                      secondsDraft === d.value / 1000 &&
                        styles.secondsChipTextActive,
                    ]}
                  >
                    {d.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.secondsRow}>
              <TouchableOpacity
                onPress={() => setSecondsDraft(s => Math.max(1, s - 1))}
                style={styles.secondsBtn}
              >
                <Icon name="remove" size={22} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.secondsValue}>{secondsDraft}s</Text>
              <TouchableOpacity
                onPress={() => setSecondsDraft(s => Math.min(30, s + 1))}
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

        {/* Video Viewer */}
        <Modal
          isVisible={videoVisible}
          onBackdropPress={closeVideoModal}
          onBackButtonPress={closeVideoModal}
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
              playInBackground={false}
              ignoreSilentSwitch="ignore"
            />
            <TouchableOpacity
              onPress={closeVideoModal}
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

const styles = StyleSheet.create({
  container: { flex: 1 },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
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
  avatarContainer: { marginRight: 12 },
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
  filterButton: { marginLeft: 8 },
  filterGradient: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectButton: { marginLeft: 12 },

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
  seeAllButton: { borderRadius: 16 },
  seeAllGradient: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
  },
  seeAll: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 14 },

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
    marginHorizontal: 4,
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
  photoInfoText: { color: '#FFFFFF', fontSize: 14, marginVertical: 2 },

  reactionsDisplay: { position: 'absolute', bottom: 160, left: 20 },
  reactionsRow: { flexDirection: 'row', alignItems: 'center' },
  displayedReaction: { fontSize: 20, marginRight: 4 },
  moreReactions: { color: '#FFFFFF', fontSize: 14, marginLeft: 8 },

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
  dropdownItemActive: { backgroundColor: 'rgba(102, 126, 234, 0.1)' },
  dropdownText: { marginLeft: 12, fontSize: 15 },

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

  videoCloseButton: { position: 'absolute', top: 40, right: 20 },
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

// // screens/GalleryScreen.js
// // Smooth swipe (no flashes), video in pager with tap-to-play,
// // slideshow seconds picker, binary share, household-aware push (include_sender:true)
// // HeaderComponent/FooterComponent are proper functions. No FastImage used.
// // Heavy logging enabled throughout.

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
//   PermissionsAndroid,
//   ToastAndroid,
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
// import { useFocusEffect } from '@react-navigation/native';
// import LinearGradient from 'react-native-linear-gradient';

// const log = (...a) => console.log('[Gallery]', ...a);

// // Storage/Upload controls
// const IMAGEKIT_LIMIT_GB = 19;
// const IMAGEKIT_PUBLIC_KEY = 'public_IAZdw7PGwJlYkHZC8/KN4/9TdRw=';

// // OPTIONAL: enable direct Cloudinary unsigned fallback for big videos
// // Create an unsigned preset in Cloudinary (Settings -> Upload -> Upload presets -> Add unsigned)
// // Then fill these:
// const CLOUDINARY_CLOUD_NAME = ''; // e.g. 'my-cloud-name'
// const CLOUDINARY_UNSIGNED_PRESET = ''; // e.g. 'unsigned_preset_name'

// // Filter options
// const FILTERS = [
//   { label: 'All', value: 'all', icon: 'albums', color: '#667EEA' },
//   { label: 'Photos', value: 'photo', icon: 'image', color: '#FF6B9D' },
//   { label: 'Videos', value: 'video', icon: 'videocam', color: '#06FFA5' },
//   { label: 'Favorites', value: 'favorites', icon: 'heart', color: '#E63946' },
//   { label: 'This Month', value: 'month', icon: 'calendar', color: '#FFD60A' },
//   { label: 'This Week', value: 'week', icon: 'today', color: '#00D4FF' },
// ];

// // Reactions + slideshow durations
// const REACTIONS = ['❤️', '😍', '🔥', '💕', '✨', '😊'];
// const SLIDESHOW_DURATIONS = [
//   { label: '3 sec', value: 3000 },
//   { label: '5 sec', value: 5000 },
//   { label: '10 sec', value: 10000 },
//   { label: '15 sec', value: 15000 },
// ];

// const { width } = Dimensions.get('window');

// const GalleryScreen = ({ navigation }) => {
//   const { theme } = useTheme();
//   const fadeAnim = useRef(new Animated.Value(0)).current;
//   const scaleAnim = useRef(new Animated.Value(0.9)).current;
//   const reactionAnim = useRef(new Animated.Value(0)).current;

//   // Data
//   const [images, setImages] = useState([]);
//   const [avatarUrl, setAvatarUrl] = useState('');
//   const [userId, setUserId] = useState('');
//   const [userName, setUserName] = useState('');
//   const [householdId, setHouseholdId] = useState(null);

//   // UI
//   const [loading, setLoading] = useState(true);
//   const [refreshing, setRefreshing] = useState(false);
//   const [uploading, setUploading] = useState(false);
//   const [progress, setProgress] = useState(0);

//   // Search & Filter
//   const [search, setSearch] = useState('');
//   const [filter, setFilter] = useState('all');
//   const [showFilterDropdown, setShowFilterDropdown] = useState(false);

//   // Viewer
//   const [isViewerVisible, setIsViewerVisible] = useState(false);
//   const [viewerStartIndex, setViewerStartIndex] = useState(0); // only used when opening
//   const [showPhotoInfo, setShowPhotoInfo] = useState(false);

//   // Slideshow
//   const [slideshowActive, setSlideshowActive] = useState(false);
//   const [slideshowDuration, setSlideshowDuration] = useState(5000);
//   const [secondsModalVisible, setSecondsModalVisible] = useState(false);
//   const [secondsDraft, setSecondsDraft] = useState(5);
//   const slideshowTimer = useRef(null);
//   const pausedByUserSwipeRef = useRef(false);
//   const swipeResumeTimeoutRef = useRef(null);

//   // Video
//   const [videoVisible, setVideoVisible] = useState(false);
//   const [videoUri, setVideoUri] = useState('');
//   const videoSupportedRef = useRef(false);
//   const resumeSlideshowAfterVideoRef = useRef(false);
//   const currentViewerIndexRef = useRef(0);

//   // Reactions
//   const [showReactions, setShowReactions] = useState(false);
//   const [imageReactions, setImageReactions] = useState({});

//   // Multi-select
//   const [multiSelect, setMultiSelect] = useState(false);
//   const [selectedIds, setSelectedIds] = useState([]);

//   // Status modals
//   const [errorModal, setErrorModal] = useState({ visible: false, message: '' });
//   const [successModal, setSuccessModal] = useState({
//     visible: false,
//     message: '',
//   });

//   // Freeze viewer sources while open
//   const [viewerFrozenSources, setViewerFrozenSources] = useState([]);

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
//   }, [fadeAnim, scaleAnim]);

//   // Detect RCTVideo
//   useEffect(() => {
//     try {
//       const cfg = UIManager.getViewManagerConfig
//         ? UIManager.getViewManagerConfig('RCTVideo')
//         : UIManager.RCTVideo;
//       log('RCTVideo available:', !!cfg);
//       videoSupportedRef.current = !!cfg;
//     } catch (e) {
//       log('RCTVideo VM lookup error:', e);
//       videoSupportedRef.current = false;
//     }
//   }, []);

//   // Load profile
//   const fetchProfile = useCallback(async () => {
//     try {
//       const {
//         data: { user },
//         error,
//       } = await supabase.auth.getUser();
//       if (error) log('getUser error:', error);
//       if (!user) return;
//       setUserId(user.id);
//       const { data, error: pErr } = await supabase
//         .from('profiles')
//         .select('avatar_url, username, household_id')
//         .eq('id', user.id)
//         .maybeSingle();
//       if (pErr) log('profile fetch error:', pErr);
//       setAvatarUrl(data?.avatar_url || '');
//       setUserName(data?.username || 'User');
//       setHouseholdId(data?.household_id || null);
//       log('Loaded profile:', {
//         avatar: data?.avatar_url,
//         username: data?.username,
//         hh: data?.household_id,
//       });
//     } catch (e) {
//       log('fetchProfile exception:', e);
//     }
//   }, []);

//   useEffect(() => {
//     fetchProfile();
//   }, [fetchProfile]);
//   useFocusEffect(
//     useCallback(() => {
//       fetchProfile();
//     }, [fetchProfile]),
//   );

//   // Fetch images (ONLY public images: exclude private=true)
//   const fetchImages = useCallback(async () => {
//     try {
//       log('--- Fetching images from Supabase... ---');
//       setLoading(true);
//       const { data, error } = await supabase
//         .from('images')
//         .select('*')
//         .eq('private', false)
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
//     }
//   }, []);

//   // Fetch reactions
//   const fetchReactions = useCallback(async () => {
//     try {
//       const { data: reactions } = await supabase.from('reactions').select('*');
//       const byImage = {};
//       reactions?.forEach(r => {
//         if (!byImage[r.image_id]) byImage[r.image_id] = [];
//         byImage[r.image_id].push(r);
//       });
//       setImageReactions(byImage);
//       log('Fetched reactions');
//     } catch (e) {
//       log('Reactions fetch error:', e);
//     }
//   }, []);

//   // Subscribe realtime
//   useEffect(() => {
//     fetchImages();
//     fetchReactions();

//     const ch = supabase
//       .channel('public:images')
//       .on(
//         'postgres_changes',
//         { event: '*', schema: 'public', table: 'images' },
//         () => {
//           fetchImages();
//         },
//       )
//       .subscribe();

//     const reactionsCh = supabase
//       .channel('public:reactions')
//       .on(
//         'postgres_changes',
//         { event: '*', schema: 'public', table: 'reactions' },
//         () => {
//           fetchReactions();
//         },
//       )
//       .subscribe();

//     return () => {
//       supabase.removeChannel(ch);
//       supabase.removeChannel(reactionsCh);
//       log('Realtime channels removed');
//     };
//   }, [fetchImages, fetchReactions]);

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

//   // Filters -> filtered list
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

//   const groupedImages = useMemo(
//     () => groupImagesByDate(filteredImages),
//     [filteredImages, groupImagesByDate],
//   );

//   // Viewer: photos only (match DayGallery)
//   const viewerItems = useMemo(
//     () => filteredImages.filter(m => m.type !== 'video'),
//     [filteredImages],
//   );
//   const viewerSources = useMemo(
//     () => viewerItems.map(img => ({ uri: img.image_url })),
//     [viewerItems],
//   );

//   // Prefetch neighbors – intentionally disabled to reduce Android bitmap pressure
//   const prefetchNeighbors = useCallback(() => {}, []);

//   // Robust video upload helper with optional Cloudinary unsigned fallback
//   const uploadVideoWithFallback = useCallback(async asset => {
//     // 1) Try your existing backend first (base64 to server -> Cloudinary)
//     try {
//       const localPath = (asset.uri || '').replace('file://', '');
//       const base64 = await BlobUtil.fs.readFile(localPath, 'base64');

//       const res = await fetch(
//         'https://boyfriend-needs-backend.vercel.app/api/cloudinary-upload',
//         {
//           method: 'POST',
//           headers: { 'Content-Type': 'application/json' },
//           body: JSON.stringify({
//             fileBase64: `data:${asset.type};base64,${base64}`,
//           }),
//         },
//       );

//       const contentType = res.headers.get('content-type') || '';
//       if (!res.ok) {
//         const text = await res.text();
//         throw new Error(`Server ${res.status}: ${text.slice(0, 300)}`);
//       }

//       if (contentType.includes('application/json')) {
//         const json = await res.json();
//         if (!json?.url) {
//           throw new Error(
//             'Cloudinary upload failed (video): missing url in server response',
//           );
//         }
//         return { url: json.url, storage: 'cloudinary' };
//       } else {
//         const text = await res.text();
//         throw new Error(`Server responded non-JSON: ${text.slice(0, 300)}`);
//       }
//     } catch (err) {
//       log('[Upload][Video] Server route failed:', err?.message || err);
//     }

//     // 2) Optional fallback: direct unsigned upload to Cloudinary (no server size limit)
//     if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UNSIGNED_PRESET) {
//       throw new Error(
//         'Video upload failed on server. Tip: Large files exceed serverless body limits. Set CLOUDINARY_CLOUD_NAME and CLOUDINARY_UNSIGNED_PRESET for direct fallback or compress the video.',
//       );
//     }

//     try {
//       const path = (asset.uri || '').startsWith('file://')
//         ? asset.uri.replace('file://', '')
//         : asset.uri || '';
//       const wrapped = BlobUtil.wrap(path);
//       const fileName = asset.fileName || `video_${Date.now()}.mp4`;
//       const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`;

//       const form = [
//         { name: 'file', filename: fileName, data: wrapped },
//         { name: 'upload_preset', data: CLOUDINARY_UNSIGNED_PRESET },
//       ];

//       const task = BlobUtil.fetch('POST', uploadUrl, {}, form);
//       const res = await task;
//       const status = res.info().status;
//       const headers = res.info().headers || {};
//       const ct = headers['Content-Type'] || headers['content-type'] || '';

//       if (status >= 300) {
//         const txt = await res.text();
//         throw new Error(
//           `Cloudinary direct upload ${status}: ${txt.slice(0, 300)}`,
//         );
//       }

//       let json;
//       if (ct.includes('application/json')) {
//         json = res.json();
//       } else {
//         const txt = await res.text();
//         json = JSON.parse(txt);
//       }

//       if (!json?.secure_url && !json?.url) {
//         throw new Error('Cloudinary direct upload ok but missing secure_url.');
//       }
//       return { url: json.secure_url || json.url, storage: 'cloudinary' };
//     } catch (err2) {
//       log(
//         '[Upload][Video] Direct Cloudinary fallback failed:',
//         err2?.message || err2,
//       );
//       throw err2;
//     }
//   }, []);

//   // Upload
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
//           log('Usage response:', usage, 'useImageKit:', useImageKit);

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

//             if (isVideo) {
//               // Robust server-first + optional Cloudinary unsigned fallback
//               try {
//                 const out = await uploadVideoWithFallback(asset);
//                 uploadUrl = out.url;
//                 storageType = out.storage;
//                 log('Video upload success:', uploadUrl);
//               } catch (e) {
//                 log('Video upload error:', e?.message || e);
//                 setErrorModal({
//                   visible: true,
//                   message: e?.message || 'Video upload failed',
//                 });
//                 // Stop the entire multi-upload loop for now
//                 break;
//               }
//             } else {
//               // Photos: ImageKit if allowed; fallback to Cloudinary
//               if (useImageKit) {
//                 try {
//                   log(
//                     `[${i + 1}/${assets.length}] Getting ImageKit signature...`,
//                   );
//                   const signatureData = await fetch(
//                     'https://boyfriend-needs-backend.vercel.app/api/imagekit-auth',
//                   ).then(res => res.json());
//                   const fileName = asset.fileName || `media_${Date.now()}_${i}`;
//                   const wrappedPath = BlobUtil.wrap(
//                     (asset.uri || '').startsWith('file://')
//                       ? asset.uri.replace('file://', '')
//                       : asset.uri || '',
//                   );
//                   const uploadData = [
//                     { name: 'file', filename: fileName, data: wrappedPath },
//                     { name: 'publicKey', data: IMAGEKIT_PUBLIC_KEY },
//                     { name: 'signature', data: signatureData.signature },
//                     { name: 'expire', data: String(signatureData.expire) },
//                     { name: 'token', data: signatureData.token },
//                     { name: 'fileName', data: fileName },
//                   ];

//                   log(
//                     `[${i + 1}/${
//                       assets.length
//                     }] Uploading to ImageKit (photo)...`,
//                   );
//                   const tStart = Date.now();
//                   const task = BlobUtil.fetch(
//                     'POST',
//                     'https://upload.imagekit.io/api/v1/files/upload',
//                     {},
//                     uploadData,
//                   );
//                   task.uploadProgress((written, total) => {
//                     const pct =
//                       total > 0 ? Math.round((written / total) * 100) : 0;
//                     setProgress(pct);
//                   });
//                   const uploadResult = await task;
//                   const resultJson = uploadResult.json();
//                   const status = uploadResult.info().status;
//                   log('ImageKit upload HTTP status:', status);
//                   if (status >= 300)
//                     throw new Error(
//                       resultJson?.message || 'ImageKit upload failed',
//                     );
//                   uploadUrl = resultJson.url;
//                   storageType = 'imagekit';
//                   log(
//                     'ImageKit upload success (photo):',
//                     uploadUrl,
//                     'timeMs:',
//                     Date.now() - tStart,
//                   );
//                 } catch (e) {
//                   log('ImageKit error -> fallback Cloudinary (photo):', e);
//                   const fileBase64 = await BlobUtil.fs.readFile(
//                     (asset.uri || '').replace('file://', ''),
//                     'base64',
//                   );
//                   const tStart = Date.now();
//                   const cloudRes = await fetch(
//                     'https://boyfriend-needs-backend.vercel.app/api/cloudinary-upload',
//                     {
//                       method: 'POST',
//                       headers: { 'Content-Type': 'application/json' },
//                       body: JSON.stringify({
//                         fileBase64: `data:${asset.type};base64,${fileBase64}`,
//                       }),
//                     },
//                   );
//                   const contentType =
//                     cloudRes.headers.get('content-type') || '';
//                   if (!cloudRes.ok) {
//                     const txt = await cloudRes.text();
//                     throw new Error(
//                       `Cloudinary (photo) server ${
//                         cloudRes.status
//                       }: ${txt.slice(0, 300)}`,
//                     );
//                   }
//                   const cloudJson = contentType.includes('application/json')
//                     ? await cloudRes.json()
//                     : JSON.parse(await cloudRes.text());
//                   if (!cloudJson.url)
//                     throw new Error('Cloudinary upload failed (photo)');
//                   uploadUrl = cloudJson.url;
//                   storageType = 'cloudinary';
//                   log(
//                     'Cloudinary upload success (photo):',
//                     uploadUrl,
//                     'timeMs:',
//                     Date.now() - tStart,
//                   );
//                 }
//               } else {
//                 log(
//                   'Uploading photo directly to Cloudinary (limit reached)...',
//                 );
//                 const fileBase64 = await BlobUtil.fs.readFile(
//                   (asset.uri || '').replace('file://', ''),
//                   'base64',
//                 );
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
//                 const contentType = cloudRes.headers.get('content-type') || '';
//                 if (!cloudRes.ok) {
//                   const txt = await cloudRes.text();
//                   throw new Error(
//                     `Cloudinary (photo) server ${cloudRes.status}: ${txt.slice(
//                       0,
//                       300,
//                     )}`,
//                   );
//                 }
//                 const cloudJson = contentType.includes('application/json')
//                   ? await cloudRes.json()
//                   : JSON.parse(await cloudRes.text());
//                 if (!cloudJson.url)
//                   throw new Error('Cloudinary upload failed (photo)');
//                 uploadUrl = cloudJson.url;
//                 storageType = 'cloudinary';
//                 log(
//                   'Cloudinary upload success (photo):',
//                   uploadUrl,
//                   'timeMs:',
//                   Date.now() - tStart,
//                 );
//               }
//             }

//             // Insert with household_id for targeting
//             log('Inserting row into images...', {
//               type,
//               storageType,
//               householdId,
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
//                 household_id: householdId,
//               })
//               .select('*')
//               .single();
//             if (sErr || !inserted) {
//               log('Insert error:', sErr, 'inserted:', inserted);
//               setErrorModal({
//                 visible: true,
//                 message: sErr?.message || 'Insert failed',
//               });
//               break;
//             }
//             log('Inserted image row:', inserted?.id);

//             // Push (sender + receiver)
//             try {
//               const { data: fnRes, error: fnErr } =
//                 await supabase.functions.invoke('push-new-image-v1', {
//                   body: { image_id: inserted.id, include_sender: true },
//                 });
//               log('push-new-image-v1 result:', fnRes, fnErr);
//             } catch (fnCatch) {
//               log('push-new-image-v1 exception:', fnCatch);
//             }

//             successCount++;
//             log(`[${i + 1}/${assets.length}] Done. image_id:`, inserted.id);
//           }

//           if (successCount > 0) {
//             setSuccessModal({
//               visible: true,
//               message: `${successCount} file(s) uploaded!`,
//             });
//             fetchImages();
//           }
//         } catch (e) {
//           log('Upload exception:', e);
//           setErrorModal({ visible: true, message: e.message || String(e) });
//         } finally {
//           setUploading(false);
//           setProgress(0);
//         }
//       },
//     );
//   };

//   const onRefresh = () => {
//     setRefreshing(true);
//     log('Pull-to-refresh triggered.');
//     fetchImages();
//     fetchReactions();
//   };

//   // Open item
//   const openItem = item => {
//     log('Open item:', { id: item.id, type: item.type });
//     if (multiSelect) {
//       toggleSelect(item.id);
//       return;
//     }

//     if (item.type !== 'video') {
//       const idx = viewerItems.findIndex(p => p.id === item.id);
//       setViewerStartIndex(Math.max(0, idx));
//       currentViewerIndexRef.current = Math.max(0, idx);
//       setShowReactions(false);
//       setShowPhotoInfo(false);
//       setViewerFrozenSources(viewerSources); // freeze
//       setIsViewerVisible(true);
//       prefetchNeighbors(idx);
//       return;
//     }

//     if (videoSupportedRef.current) {
//       setVideoUri(item.image_url);
//       setVideoVisible(true);
//     } else {
//       Alert.alert(
//         'Opening externally',
//         'Native video module missing; opening in external player.',
//       );
//       Linking.openURL(item.image_url);
//     }
//   };

//   // Video inside viewer
//   const openVideoFromViewer = url => {
//     if (slideshowActive) {
//       clearInterval(slideshowTimer.current);
//       slideshowTimer.current = null;
//       setSlideshowActive(false);
//       resumeSlideshowAfterVideoRef.current = true;
//     } else {
//       resumeSlideshowAfterVideoRef.current = false;
//     }
//     setVideoUri(url);
//     setVideoVisible(true);
//   };

//   const closeVideoModal = () => {
//     setVideoVisible(false);
//     if (resumeSlideshowAfterVideoRef.current) {
//       resumeSlideshowAfterVideoRef.current = false;
//       setSlideshowActive(true);
//       startSlideshowTimer();
//     }
//   };

//   // Share (binary)
//   const handleShareCurrent = async (currentUrl, isVideo) => {
//     try {
//       const url = currentUrl;
//       const defaultExt = isVideo ? 'mp4' : 'jpg';
//       const cleanUrl = url.split('?')[0];
//       const extFromUrl = cleanUrl.includes('.')
//         ? cleanUrl.split('.').pop()
//         : defaultExt;
//       const ext =
//         (extFromUrl || defaultExt).toLowerCase().replace(/[^a-z0-9]/gi, '') ||
//         defaultExt;

//       const cachePath = `${
//         BlobUtil.fs.dirs.CacheDir
//       }/share_${Date.now()}.${ext}`;
//       log('[Share] cachePath:', cachePath);
//       await BlobUtil.config({ path: cachePath, fileCache: true }).fetch(
//         'GET',
//         url,
//       );
//       const fileUrl = `file://${cachePath}`;
//       const mime = isVideo
//         ? 'video/mp4'
//         : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
//       await Share.open({ url: fileUrl, type: mime, failOnCancel: false });
//     } catch (e) {
//       log('[Share] binary failed, fallback -> link:', e?.message || e);
//       try {
//         await Share.open({ url: currentUrl, failOnCancel: false });
//       } catch (e2) {
//         if (e2?.message !== 'User did not share') {
//           setErrorModal({
//             visible: true,
//             message: e2.message || 'Share failed',
//           });
//         }
//       }
//     }
//   };

//   // Save file
//   const handleSaveCurrent = async item => {
//     try {
//       if (!item) return;
//       if (item.type === 'video') {
//         Alert.alert(
//           'Open Video',
//           'Use the video player to download/share the video.',
//           [
//             { text: 'Cancel', style: 'cancel' },
//             {
//               text: 'Open',
//               onPress: () => openVideoFromViewer(item.image_url),
//             },
//           ],
//         );
//         return;
//       }

//       if (Platform.OS === 'android') {
//         try {
//           const androidVersion = Platform.Version;
//           if (androidVersion >= 33) {
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
//         } catch {}
//       }

//       const fileUrl = item.image_url;
//       const fileName =
//         item.file_name || fileUrl.split('/').pop() || `image_${Date.now()}.jpg`;
//       const dirs = BlobUtil.fs.dirs;
//       const dest =
//         Platform.OS === 'android'
//           ? `${dirs.PictureDir}/Gallery/${fileName}`
//           : `${dirs.DocumentDir}/${fileName}`;
//       log('[Save] dest:', dest);

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
//           `Saved to Pictures/Gallery/${fileName}`,
//           ToastAndroid.LONG,
//         );
//       } else {
//         await BlobUtil.config({ path: dest }).fetch('GET', fileUrl);
//       }

//       setSuccessModal({ visible: true, message: 'Image saved successfully!' });
//     } catch (e) {
//       setErrorModal({ visible: true, message: 'Failed to save: ' + e.message });
//     }
//   };

//   // Toggle favorite
//   const toggleFavoriteItem = async item => {
//     if (!item || item.type === 'video') return;
//     try {
//       const updated = !item.favorite;
//       await supabase
//         .from('images')
//         .update({ favorite: updated })
//         .eq('id', item.id);
//       setImages(prev =>
//         prev.map(i => (i.id === item.id ? { ...i, favorite: updated } : i)),
//       );
//     } catch (e) {
//       setErrorModal({ visible: true, message: e.message });
//     }
//   };

//   // Toggle reaction
//   const toggleReactionForItem = async (emoji, item) => {
//     if (!item || item.type === 'video') return;
//     try {
//       const existing = imageReactions[item.id] || [];
//       const userReaction = existing.find(
//         r => r.user_id === userId && r.emoji === emoji,
//       );
//       if (userReaction) {
//         const { error } = await supabase
//           .from('reactions')
//           .delete()
//           .match({ image_id: item.id, user_id: userId, emoji });
//         if (error) throw error;
//         setImageReactions(prev => ({
//           ...prev,
//           [item.id]: prev[item.id].filter(
//             r => !(r.user_id === userId && r.emoji === emoji),
//           ),
//         }));
//       } else {
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
//           image_id: item.id,
//           user_id: userId,
//           emoji,
//           created_at: new Date().toISOString(),
//         });
//         if (error) throw error;
//         setImageReactions(prev => ({
//           ...prev,
//           [item.id]: [...(prev[item.id] || []), { user_id: userId, emoji }],
//         }));
//       }
//     } catch (e) {
//       setErrorModal({ visible: true, message: 'Failed to update reaction' });
//     }
//   };

//   // Slideshow control
//   const startSlideshowTimer = () => {
//     if (slideshowTimer.current) clearInterval(slideshowTimer.current);
//     if (!isViewerVisible) return;
//     const total =
//       (viewerFrozenSources.length
//         ? viewerFrozenSources.length
//         : viewerItems.length) || 0;
//     if (total <= 1) return;
//     slideshowTimer.current = setInterval(() => {
//       try {
//         const next = (currentViewerIndexRef.current + 1) % total;
//         currentViewerIndexRef.current = next;
//         setViewerStartIndex(next);
//       } catch {}
//     }, slideshowDuration);
//   };

//   const stopSlideshowTimer = () => {
//     if (slideshowTimer.current) {
//       clearInterval(slideshowTimer.current);
//       slideshowTimer.current = null;
//     }
//   };

//   const confirmSlideshowSeconds = () => {
//     const ms = Math.max(1, Math.min(30, secondsDraft)) * 1000;
//     setSecondsModalVisible(false);
//     setSlideshowDuration(ms);
//     setSlideshowActive(true);
//     startSlideshowTimer();
//   };

//   useEffect(() => {
//     if (slideshowActive) startSlideshowTimer();
//   }, [slideshowActive, slideshowDuration, isViewerVisible]);

//   useEffect(() => {
//     return () => {
//       stopSlideshowTimer();
//       if (swipeResumeTimeoutRef.current)
//         clearTimeout(swipeResumeTimeoutRef.current);
//     };
//   }, []);

//   // Multi-select
//   const toggleSelect = id =>
//     setSelectedIds(prev =>
//       prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id],
//     );
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
//           fetchImages();
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
//       const paths = [];
//       for (const url of urls) {
//         try {
//           const clean = url.split('?')[0];
//           const ext = clean.includes('.') ? clean.split('.').pop() : 'jpg';
//           const path = `${
//             BlobUtil.fs.dirs.CacheDir
//           }/share_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
//           await BlobUtil.config({ path, fileCache: true }).fetch('GET', url);
//           paths.push(`file://${path}`);
//         } catch (e) {}
//       }
//       if (paths.length) await Share.open({ urls: paths, failOnCancel: false });
//       else await Share.open({ urls, failOnCancel: false });
//     } catch {}
//   };
//   const handleBatchFavoriteToggle = async () => {
//     if (!selectedIds.length) return;
//     try {
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
//     } catch (e) {
//       setErrorModal({ visible: true, message: e.message });
//     }
//   };
//   const handleSelectAll = () => {
//     const ids = filteredImages.map(i => i.id);
//     setSelectedIds(ids);
//     setMultiSelect(true);
//   };

//   // Render section
//   const renderSection = (date, imagesArr) => {
//     const showSeeAll = imagesArr.length > 4;
//     const imagesToShow = showSeeAll ? imagesArr.slice(0, 4) : imagesArr;
//     return (
//       <Animated.View
//         key={date}
//         style={[
//           styles.section,
//           { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
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
//               suspend={isViewerVisible} // free memory while viewer open
//             />
//           )}
//           scrollEnabled={false}
//         />
//       </Animated.View>
//     );
//   };

//   // Header component for ImageViewing
//   const ViewerHeader = () => {
//     return (
//       <LinearGradient
//         colors={['rgba(0,0,0,0.7)', 'transparent']}
//         style={styles.viewerHeader}
//       >
//         <TouchableOpacity
//           onPress={() => {
//             setIsViewerVisible(false);
//             setViewerFrozenSources([]);
//             if (slideshowActive) {
//               stopSlideshowTimer();
//               setSlideshowActive(false);
//             }
//           }}
//           style={styles.viewerCloseButton}
//         >
//           <Icon name="close" size={28} color="#FFFFFF" />
//         </TouchableOpacity>
//         <View style={styles.viewerHeaderActions}>
//           <TouchableOpacity
//             onPress={() =>
//               slideshowActive
//                 ? (stopSlideshowTimer(), setSlideshowActive(false))
//                 : setSecondsModalVisible(true)
//             }
//             style={styles.viewerHeaderButton}
//           >
//             <Icon
//               name={slideshowActive ? 'pause' : 'play'}
//               size={24}
//               color="#FFFFFF"
//             />
//           </TouchableOpacity>
//           <TouchableOpacity
//             onPress={() => setShowPhotoInfo(v => !v)}
//             style={styles.viewerHeaderButton}
//           >
//             <Icon name="information-circle" size={24} color="#FFFFFF" />
//           </TouchableOpacity>
//         </View>
//       </LinearGradient>
//     );
//   };

//   // Footer component for ImageViewing
//   const ViewerFooter = ({ imageIndex }) => {
//     const item = viewerItems[imageIndex];
//     if (!item) return null;
//     const reactions = imageReactions[item.id] || [];
//     return (
//       <View pointerEvents="box-none">
//         {/* Photo info */}
//         {showPhotoInfo && (
//           <LinearGradient
//             colors={['transparent', 'rgba(0,0,0,0.9)']}
//             style={styles.photoInfoPanel}
//           >
//             <Text style={styles.photoInfoTitle}>Photo Details</Text>
//             <Text style={styles.photoInfoText}>
//               Name: {item.file_name || 'Untitled'}
//             </Text>
//             <Text style={styles.photoInfoText}>
//               Date: {format(parseISO(item.created_at), 'PPpp')}
//             </Text>
//             <Text style={styles.photoInfoText}>
//               Storage: {item.storage_type}
//             </Text>
//             <Text style={styles.photoInfoText}>Type: {item.type}</Text>
//           </LinearGradient>
//         )}

//         {/* Reactions display */}
//         {reactions.length > 0 && (
//           <View style={styles.reactionsDisplay}>
//             <View style={styles.reactionsRow}>
//               {reactions.slice(0, 5).map((r, idx) => (
//                 <Text key={idx} style={styles.displayedReaction}>
//                   {r.emoji}
//                 </Text>
//               ))}
//               {reactions.length > 5 && (
//                 <Text style={styles.moreReactions}>
//                   +{reactions.length - 5}
//                 </Text>
//               )}
//             </View>
//           </View>
//         )}

//         {/* Footer actions */}
//         <LinearGradient
//           colors={['transparent', 'rgba(0,0,0,0.8)']}
//           style={styles.viewerFooter}
//         >
//           <TouchableOpacity
//             style={styles.viewerButton}
//             onPress={() => handleShareCurrent(item.image_url, false)}
//           >
//             <Icon name="share-social" size={24} color="#FFFFFF" />
//           </TouchableOpacity>
//           <TouchableOpacity
//             style={styles.viewerButton}
//             onPress={() => handleSaveCurrent(item)}
//           >
//             <Icon name="download" size={24} color="#FFFFFF" />
//           </TouchableOpacity>
//           <TouchableOpacity
//             style={styles.viewerButton}
//             onPress={() => toggleFavoriteItem(item)}
//           >
//             <Icon
//               name={item.favorite ? 'heart' : 'heart-outline'}
//               size={24}
//               color={item.favorite ? theme.shared?.red || '#FF5252' : '#FFFFFF'}
//             />
//           </TouchableOpacity>
//           <TouchableOpacity
//             style={styles.viewerButton}
//             onPress={() => setShowReactions(v => !v)}
//           >
//             <Icon name="happy" size={24} color="#FFFFFF" />
//           </TouchableOpacity>
//           <TouchableOpacity
//             style={styles.viewerButton}
//             onPress={() =>
//               Alert.alert('Delete', 'Delete this photo?', [
//                 { text: 'Cancel', style: 'cancel' },
//                 {
//                   text: 'Delete',
//                   style: 'destructive',
//                   onPress: async () => {
//                     const { error } = await supabase
//                       .from('images')
//                       .delete()
//                       .eq('id', item.id);
//                     if (error)
//                       setErrorModal({
//                         visible: true,
//                         message: error.message,
//                       });
//                     else {
//                       setIsViewerVisible(false);
//                       setViewerFrozenSources([]);
//                       fetchImages();
//                     }
//                   },
//                 },
//               ])
//             }
//           >
//             <Icon
//               name="trash"
//               size={24}
//               color={theme.shared?.red || '#FF5252'}
//             />
//           </TouchableOpacity>
//         </LinearGradient>
//       </View>
//     );
//   };

//   // Loading (after hooks)
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
//               {avatarUrl ? (
//                 <Image source={{ uri: avatarUrl }} style={styles.avatar} />
//               ) : (
//                 <Icon name="person" size={24} color="#FFFFFF" />
//               )}
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
//               <MenuOption
//                 onSelect={() => navigation.navigate('Personalization')}
//               >
//                 <View style={styles.menuOptionContainer}>
//                   <Icon
//                     name="color-palette"
//                     size={20}
//                     color={theme.shared.orange}
//                   />
//                   <Text style={styles.menuOption}>Personalization</Text>
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

//         {/* Search + Filter */}
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
//               placeholder="Search memories..."
//               placeholderTextColor={theme.colors.primary + '60'}
//               value={search}
//               onChangeText={setSearch}
//               selectionColor={theme.colors.primary}
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
//               { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
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

//         {/* Black backdrop under viewer */}
//         {isViewerVisible && (
//           <View pointerEvents="none" style={styles.viewerBackdrop} />
//         )}

//         {/* Media Viewer (photos only to match DayGallery) */}
//         <ImageViewing
//           images={
//             viewerFrozenSources.length ? viewerFrozenSources : viewerSources
//           }
//           imageIndex={viewerStartIndex}
//           visible={isViewerVisible}
//           onRequestClose={() => {
//             setIsViewerVisible(false);
//             setViewerFrozenSources([]);
//             if (slideshowActive) {
//               stopSlideshowTimer();
//               setSlideshowActive(false);
//             }
//           }}
//           doubleTapToZoomEnabled
//           swipeToCloseEnabled
//           onImageIndexChange={idx => {
//             currentViewerIndexRef.current = idx;
//             setShowReactions(false);
//             setShowPhotoInfo(false);

//             if (slideshowActive) {
//               pausedByUserSwipeRef.current = true;
//               stopSlideshowTimer();
//               setSlideshowActive(false);
//               if (swipeResumeTimeoutRef.current)
//                 clearTimeout(swipeResumeTimeoutRef.current);
//               swipeResumeTimeoutRef.current = setTimeout(() => {
//                 if (pausedByUserSwipeRef.current) {
//                   pausedByUserSwipeRef.current = false;
//                   setSlideshowActive(true);
//                   startSlideshowTimer();
//                 }
//               }, 600);
//             }
//           }}
//           HeaderComponent={ViewerHeader}
//           FooterComponent={ViewerFooter}
//         />

//         {/* Slideshow seconds modal */}
//         <Modal
//           isVisible={secondsModalVisible}
//           onBackdropPress={() => setSecondsModalVisible(false)}
//           onBackButtonPress={() => setSecondsModalVisible(false)}
//           backdropOpacity={0.5}
//           useNativeDriver
//         >
//           <View style={styles.secondsModal}>
//             <Text style={styles.secondsTitle}>Slideshow interval</Text>
//             <View style={styles.secondsChips}>
//               {SLIDESHOW_DURATIONS.map(d => (
//                 <TouchableOpacity
//                   key={d.value}
//                   style={[
//                     styles.secondsChip,
//                     secondsDraft === d.value / 1000 && styles.secondsChipActive,
//                   ]}
//                   onPress={() => setSecondsDraft(d.value / 1000)}
//                 >
//                   <Text
//                     style={[
//                       styles.secondsChipText,
//                       secondsDraft === d.value / 1000 &&
//                         styles.secondsChipTextActive,
//                     ]}
//                   >
//                     {d.label}
//                   </Text>
//                 </TouchableOpacity>
//               ))}
//             </View>
//             <View style={styles.secondsRow}>
//               <TouchableOpacity
//                 onPress={() => setSecondsDraft(s => Math.max(1, s - 1))}
//                 style={styles.secondsBtn}
//               >
//                 <Icon name="remove" size={22} color="#fff" />
//               </TouchableOpacity>
//               <Text style={styles.secondsValue}>{secondsDraft}s</Text>
//               <TouchableOpacity
//                 onPress={() => setSecondsDraft(s => Math.min(30, s + 1))}
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

//         {/* Video Viewer */}
//         <Modal
//           isVisible={videoVisible}
//           onBackdropPress={closeVideoModal}
//           onBackButtonPress={closeVideoModal}
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
//               playInBackground={false}
//               ignoreSilentSwitch="ignore"
//             />
//             <TouchableOpacity
//               onPress={closeVideoModal}
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

// const styles = StyleSheet.create({
//   container: { flex: 1 },
//   loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
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
//   avatarContainer: { marginRight: 12 },
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
//     justifyContent: 'center',
//     alignItems: 'center',
//   },
//   avatar: {
//     width: 40,
//     height: 40,
//     borderRadius: 20,
//     backgroundColor: '#FFF',
//     resizeMode: 'cover',
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

//   searchBar: { marginHorizontal: 16, marginBottom: 12 },
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
//   searchInput: { flex: 1, marginLeft: 12, fontSize: 16 },
//   filterButton: { marginLeft: 8 },
//   filterGradient: {
//     width: 36,
//     height: 36,
//     borderRadius: 18,
//     justifyContent: 'center',
//     alignItems: 'center',
//   },
//   selectButton: { marginLeft: 12 },

//   section: { marginBottom: 24, marginHorizontal: 16 },
//   sectionHeaderGradient: { borderRadius: 12, marginBottom: 12 },
//   sectionHeader: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     alignItems: 'center',
//     paddingVertical: 8,
//     paddingHorizontal: 12,
//   },
//   sectionTitle: { fontSize: 18, fontWeight: 'bold' },
//   seeAllButton: { borderRadius: 16 },
//   seeAllGradient: {
//     paddingHorizontal: 16,
//     paddingVertical: 6,
//     borderRadius: 16,
//   },
//   seeAll: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 14 },

//   fab: { position: 'absolute', right: 24, bottom: 100, zIndex: 10 },
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

//   viewerBackdrop: {
//     ...StyleSheet.absoluteFillObject,
//     backgroundColor: '#000',
//     zIndex: 999,
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
//     marginHorizontal: 4,
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
//   photoInfoText: { color: '#FFFFFF', fontSize: 14, marginVertical: 2 },

//   reactionsDisplay: { position: 'absolute', bottom: 160, left: 20 },
//   reactionsRow: { flexDirection: 'row', alignItems: 'center' },
//   displayedReaction: { fontSize: 20, marginRight: 4 },
//   moreReactions: { color: '#FFFFFF', fontSize: 14, marginLeft: 8 },

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
//   dropdownItemActive: { backgroundColor: 'rgba(102, 126, 234, 0.1)' },
//   dropdownText: { marginLeft: 12, fontSize: 15 },

//   secondsModal: { backgroundColor: '#222', padding: 16, borderRadius: 16 },
//   secondsTitle: {
//     color: '#fff',
//     fontWeight: '700',
//     fontSize: 16,
//     marginBottom: 12,
//     textAlign: 'center',
//   },
//   secondsChips: {
//     flexDirection: 'row',
//     flexWrap: 'wrap',
//     justifyContent: 'center',
//   },
//   secondsChip: {
//     paddingHorizontal: 12,
//     paddingVertical: 6,
//     borderRadius: 16,
//     backgroundColor: '#333',
//     margin: 4,
//   },
//   secondsChipActive: { backgroundColor: '#555' },
//   secondsChipText: { color: '#eee', fontSize: 13, fontWeight: '600' },
//   secondsChipTextActive: { color: '#fff' },
//   secondsRow: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     justifyContent: 'center',
//     marginTop: 10,
//   },
//   secondsBtn: {
//     width: 44,
//     height: 44,
//     borderRadius: 22,
//     alignItems: 'center',
//     justifyContent: 'center',
//     backgroundColor: '#444',
//   },
//   secondsValue: {
//     color: '#fff',
//     fontWeight: '700',
//     fontSize: 18,
//     marginHorizontal: 16,
//   },
//   secondsActions: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     marginTop: 16,
//   },
//   secondsActionBtn: {
//     flex: 1,
//     paddingVertical: 10,
//     borderRadius: 12,
//     marginHorizontal: 6,
//     alignItems: 'center',
//   },
//   secondsActionText: { color: '#fff', fontWeight: '700' },

//   videoCloseButton: { position: 'absolute', top: 40, right: 20 },
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

// // screens/GalleryScreen.js
// // Smooth swipe (no flashes), video in pager with tap-to-play,
// // slideshow seconds picker, binary share, household-aware push (include_sender:true)
// // HeaderComponent/FooterComponent are proper functions. No FastImage used.
// // Heavy logging enabled throughout.

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
//   PermissionsAndroid,
//   ToastAndroid,
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
// import { useFocusEffect } from '@react-navigation/native';
// import LinearGradient from 'react-native-linear-gradient';

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

// // Reactions + slideshow durations
// const REACTIONS = ['❤️', '😍', '🔥', '💕', '✨', '😊'];
// const SLIDESHOW_DURATIONS = [
//   { label: '3 sec', value: 3000 },
//   { label: '5 sec', value: 5000 },
//   { label: '10 sec', value: 10000 },
//   { label: '15 sec', value: 15000 },
// ];

// const { width } = Dimensions.get('window');
// const TRANSPARENT_PNG =
//   'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

// const GalleryScreen = ({ navigation }) => {
//   const { theme } = useTheme();
//   const fadeAnim = useRef(new Animated.Value(0)).current;
//   const scaleAnim = useRef(new Animated.Value(0.9)).current;
//   const reactionAnim = useRef(new Animated.Value(0)).current;

//   // Data
//   const [images, setImages] = useState([]);
//   const [avatarUrl, setAvatarUrl] = useState('');
//   const [userId, setUserId] = useState('');
//   const [userName, setUserName] = useState('');
//   const [householdId, setHouseholdId] = useState(null);

//   // UI
//   const [loading, setLoading] = useState(true);
//   const [refreshing, setRefreshing] = useState(false);
//   const [uploading, setUploading] = useState(false);
//   const [progress, setProgress] = useState(0);

//   // Search & Filter
//   const [search, setSearch] = useState('');
//   const [filter, setFilter] = useState('all');
//   const [showFilterDropdown, setShowFilterDropdown] = useState(false);

//   // Viewer (don’t control index with state while swiping to avoid flicker)
//   const [isViewerVisible, setIsViewerVisible] = useState(false);
//   const [viewerStartIndex, setViewerStartIndex] = useState(0); // only used when opening
//   const [showPhotoInfo, setShowPhotoInfo] = useState(false);

//   // Slideshow
//   const [slideshowActive, setSlideshowActive] = useState(false);
//   const [slideshowDuration, setSlideshowDuration] = useState(5000);
//   const [secondsModalVisible, setSecondsModalVisible] = useState(false);
//   const [secondsDraft, setSecondsDraft] = useState(5);
//   const slideshowTimer = useRef(null);
//   const pausedByUserSwipeRef = useRef(false);
//   const swipeResumeTimeoutRef = useRef(null);

//   // Video
//   const [videoVisible, setVideoVisible] = useState(false);
//   const [videoUri, setVideoUri] = useState('');
//   const videoSupportedRef = useRef(false);
//   const resumeSlideshowAfterVideoRef = useRef(false);
//   const currentViewerIndexRef = useRef(0);

//   // Reactions
//   const [showReactions, setShowReactions] = useState(false);
//   const [imageReactions, setImageReactions] = useState({});

//   // Multi-select
//   const [multiSelect, setMultiSelect] = useState(false);
//   const [selectedIds, setSelectedIds] = useState([]);

//   // Status modals
//   const [errorModal, setErrorModal] = useState({ visible: false, message: '' });
//   const [successModal, setSuccessModal] = useState({
//     visible: false,
//     message: '',
//   });

//   // Freeze viewer sources while open (avoid re-renders that cause flashes)
//   const [viewerFrozenSources, setViewerFrozenSources] = useState([]);

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
//   }, [fadeAnim, scaleAnim]);

//   // Detect RCTVideo
//   useEffect(() => {
//     try {
//       const cfg = UIManager.getViewManagerConfig
//         ? UIManager.getViewManagerConfig('RCTVideo')
//         : UIManager.RCTVideo;
//       log('RCTVideo available:', !!cfg);
//       videoSupportedRef.current = !!cfg;
//     } catch (e) {
//       log('RCTVideo VM lookup error:', e);
//       videoSupportedRef.current = false;
//     }
//   }, []);

//   // Load profile (household_id is critical for push to receiver)
//   const fetchProfile = useCallback(async () => {
//     try {
//       const {
//         data: { user },
//         error,
//       } = await supabase.auth.getUser();
//       if (error) log('getUser error:', error);
//       if (!user) return;
//       setUserId(user.id);
//       const { data, error: pErr } = await supabase
//         .from('profiles')
//         .select('avatar_url, username, household_id')
//         .eq('id', user.id)
//         .maybeSingle();
//       if (pErr) log('profile fetch error:', pErr);
//       setAvatarUrl(data?.avatar_url || '');
//       setUserName(data?.username || 'User');
//       setHouseholdId(data?.household_id || null);
//       log('Loaded profile:', {
//         avatar: data?.avatar_url,
//         username: data?.username,
//         hh: data?.household_id,
//       });
//     } catch (e) {
//       log('fetchProfile exception:', e);
//     }
//   }, []);

//   useEffect(() => {
//     fetchProfile();
//   }, [fetchProfile]);
//   useFocusEffect(
//     useCallback(() => {
//       fetchProfile();
//     }, [fetchProfile]),
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
//     }
//   }, []);

//   // Fetch reactions
//   const fetchReactions = useCallback(async () => {
//     try {
//       const { data: reactions } = await supabase.from('reactions').select('*');
//       const byImage = {};
//       reactions?.forEach(r => {
//         if (!byImage[r.image_id]) byImage[r.image_id] = [];
//         byImage[r.image_id].push(r);
//       });
//       setImageReactions(byImage);
//       log('Fetched reactions');
//     } catch (e) {
//       log('Reactions fetch error:', e);
//     }
//   }, []);

//   // Subscribe realtime
//   useEffect(() => {
//     fetchImages();
//     fetchReactions();

//     const ch = supabase
//       .channel('public:images')
//       .on(
//         'postgres_changes',
//         { event: '*', schema: 'public', table: 'images' },
//         payload => {
//           log(
//             'Realtime(images):',
//             payload.eventType,
//             payload.new?.id || payload.old?.id,
//           );
//           fetchImages();
//         },
//       )
//       .subscribe();

//     const reactionsCh = supabase
//       .channel('public:reactions')
//       .on(
//         'postgres_changes',
//         { event: '*', schema: 'public', table: 'reactions' },
//         () => {
//           fetchReactions();
//         },
//       )
//       .subscribe();

//     return () => {
//       supabase.removeChannel(ch);
//       supabase.removeChannel(reactionsCh);
//       log('Realtime channels removed');
//     };
//   }, [fetchImages, fetchReactions]);

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

//   // Filters -> filtered list
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

//   const groupedImages = useMemo(
//     () => groupImagesByDate(filteredImages),
//     [filteredImages, groupImagesByDate],
//   );

//   // Viewer items + sources
//   const viewerItems = useMemo(() => filteredImages, [filteredImages]);
//   const viewerSources = useMemo(
//     () =>
//       viewerItems.map(m =>
//         m.type === 'video' ? { uri: TRANSPARENT_PNG } : { uri: m.image_url },
//       ),
//     [viewerItems],
//   );

//   // Prefetch neighbors (decode ahead)
//   const prefetchNeighbors = useCallback(
//     idx => {
//       try {
//         const targets = [idx - 1, idx, idx + 1]
//           .filter(i => i >= 0 && i < viewerItems.length)
//           .map(i => viewerItems[i])
//           .filter(it => it?.type === 'photo')
//           .map(it => it.image_url);
//         targets.forEach(u => Image.prefetch(u));
//         log(
//           '[Viewer] Prefetched neighbors for index:',
//           idx,
//           'targets:',
//           targets.length,
//         );
//       } catch (e) {
//         log('[Viewer] Prefetch error:', e);
//       }
//     },
//     [viewerItems],
//   );

//   // Upload
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
//           log('Usage response:', usage, 'useImageKit:', useImageKit);

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
//                 log('ImageKit error -> fallback Cloudinary:', e?.message || e);
//                 const fileBase64 = await BlobUtil.fs.readFile(
//                   (asset.uri || '').replace('file://', ''),
//                   'base64',
//                 );
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
//               log('Uploading directly to Cloudinary (limit reached)...');
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

//             // Insert with household_id for targeting
//             log('Inserting row into images...', {
//               user_id: user.id,
//               type,
//               storageType,
//               householdId,
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
//                 household_id: householdId,
//               })
//               .select('*')
//               .single();
//             if (sErr || !inserted) {
//               log('Insert error:', sErr, 'inserted:', inserted);
//               setErrorModal({
//                 visible: true,
//                 message: sErr?.message || 'Insert failed',
//               });
//               break;
//             }
//             log('Inserted image row:', inserted?.id);

//             // Push (sender + receiver)
//             try {
//               const tFn = Date.now();
//               const { data: fnRes, error: fnErr } =
//                 await supabase.functions.invoke('push-new-image-v1', {
//                   body: { image_id: inserted.id, include_sender: true },
//                 });
//               const ms = Date.now() - tFn;
//               log('push-new-image-v1 result:', fnRes, fnErr, 'ms:', ms);
//             } catch (fnCatch) {
//               log('push-new-image-v1 exception:', fnCatch);
//             }

//             successCount++;
//             log(`[${i + 1}/${assets.length}] Done. image_id:`, inserted.id);
//           }

//           if (successCount > 0) {
//             setSuccessModal({
//               visible: true,
//               message: `${successCount} file(s) uploaded!`,
//             });
//             fetchImages();
//           }
//         } catch (e) {
//           log('Upload exception:', e);
//           setErrorModal({ visible: true, message: e.message || String(e) });
//         } finally {
//           setUploading(false);
//           setProgress(0);
//         }
//       },
//     );
//   };

//   const onRefresh = () => {
//     setRefreshing(true);
//     log('Pull-to-refresh triggered.');
//     fetchImages();
//     fetchReactions();
//   };

//   // Open item (don’t set state on index change later)
//   const openItem = item => {
//     log('Open item:', { id: item.id, type: item.type });
//     if (multiSelect) {
//       toggleSelect(item.id);
//       return;
//     }

//     if (item.type !== 'video') {
//       const idx = viewerItems.findIndex(p => p.id === item.id);
//       setViewerStartIndex(Math.max(0, idx));
//       currentViewerIndexRef.current = Math.max(0, idx);
//       setIsViewerVisible(true);
//       setShowReactions(false);
//       setShowPhotoInfo(false);
//       setViewerFrozenSources(viewerSources); // freeze
//       prefetchNeighbors(idx);
//       return;
//     }

//     if (videoSupportedRef.current) {
//       setVideoUri(item.image_url);
//       setVideoVisible(true);
//     } else {
//       Alert.alert(
//         'Opening externally',
//         'Native video module missing; opening in external player.',
//       );
//       Linking.openURL(item.image_url);
//     }
//   };

//   // Video inside viewer
//   const openVideoFromViewer = url => {
//     if (slideshowActive) {
//       clearInterval(slideshowTimer.current);
//       slideshowTimer.current = null;
//       setSlideshowActive(false);
//       resumeSlideshowAfterVideoRef.current = true;
//     } else {
//       resumeSlideshowAfterVideoRef.current = false;
//     }
//     setVideoUri(url);
//     setVideoVisible(true);
//   };

//   const closeVideoModal = () => {
//     setVideoVisible(false);
//     if (resumeSlideshowAfterVideoRef.current) {
//       resumeSlideshowAfterVideoRef.current = false;
//       setSlideshowActive(true);
//       startSlideshowTimer('resume-after-video');
//     }
//   };

//   // Delete
//   const deleteCurrentPhoto = async () => {
//     // Will compute current item in footer from imageIndex; here only used when user taps delete button in footer
//     // So we handle it in the footer handler via refactor: we’ll trigger Alert from footer, not here.
//   };

//   // Share (binary)
//   const handleShareCurrent = async (currentUrl, isVideo) => {
//     try {
//       const url = currentUrl;
//       const defaultExt = isVideo ? 'mp4' : 'jpg';
//       const cleanUrl = url.split('?')[0];
//       const extFromUrl = cleanUrl.includes('.')
//         ? cleanUrl.split('.').pop()
//         : defaultExt;
//       const ext =
//         (extFromUrl || defaultExt).toLowerCase().replace(/[^a-z0-9]/gi, '') ||
//         defaultExt;

//       const cachePath = `${
//         BlobUtil.fs.dirs.CacheDir
//       }/share_${Date.now()}.${ext}`;
//       log('[Share] cachePath:', cachePath);
//       await BlobUtil.config({ path: cachePath, fileCache: true }).fetch(
//         'GET',
//         url,
//       );
//       const fileUrl = `file://${cachePath}`;
//       const mime = isVideo
//         ? 'video/mp4'
//         : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
//       await Share.open({ url: fileUrl, type: mime, failOnCancel: false });
//     } catch (e) {
//       log('[Share] binary failed, fallback -> link:', e?.message || e);
//       try {
//         await Share.open({ url: currentUrl, failOnCancel: false });
//       } catch (e2) {
//         if (e2?.message !== 'User did not share') {
//           setErrorModal({
//             visible: true,
//             message: e2.message || 'Share failed',
//           });
//         }
//       }
//     }
//   };

//   // Save file
//   const handleSaveCurrent = async item => {
//     try {
//       if (!item) return;
//       if (item.type === 'video') {
//         Alert.alert(
//           'Open Video',
//           'Use the video player to download/share the video.',
//           [
//             { text: 'Cancel', style: 'cancel' },
//             {
//               text: 'Open',
//               onPress: () => openVideoFromViewer(item.image_url),
//             },
//           ],
//         );
//         return;
//       }

//       if (Platform.OS === 'android') {
//         try {
//           const androidVersion = Platform.Version;
//           if (androidVersion >= 33) {
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
//         } catch {}
//       }

//       const fileUrl = item.image_url;
//       const fileName =
//         item.file_name || fileUrl.split('/').pop() || `image_${Date.now()}.jpg`;
//       const dirs = BlobUtil.fs.dirs;
//       const dest =
//         Platform.OS === 'android'
//           ? `${dirs.PictureDir}/Gallery/${fileName}`
//           : `${dirs.DocumentDir}/${fileName}`;
//       log('[Save] dest:', dest);

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
//           `Saved to Pictures/Gallery/${fileName}`,
//           ToastAndroid.LONG,
//         );
//       } else {
//         await BlobUtil.config({ path: dest }).fetch('GET', fileUrl);
//       }

//       setSuccessModal({ visible: true, message: 'Image saved successfully!' });
//     } catch (e) {
//       setErrorModal({ visible: true, message: 'Failed to save: ' + e.message });
//     }
//   };

//   // Toggle favorite
//   const toggleFavoriteItem = async item => {
//     if (!item || item.type === 'video') return;
//     try {
//       const updated = !item.favorite;
//       await supabase
//         .from('images')
//         .update({ favorite: updated })
//         .eq('id', item.id);
//       setImages(prev =>
//         prev.map(i => (i.id === item.id ? { ...i, favorite: updated } : i)),
//       );
//     } catch (e) {
//       setErrorModal({ visible: true, message: e.message });
//     }
//   };

//   // Toggle reaction
//   const toggleReactionForItem = async (emoji, item) => {
//     if (!item || item.type === 'video') return;
//     try {
//       const existing = imageReactions[item.id] || [];
//       const userReaction = existing.find(
//         r => r.user_id === userId && r.emoji === emoji,
//       );
//       if (userReaction) {
//         const { error } = await supabase
//           .from('reactions')
//           .delete()
//           .match({ image_id: item.id, user_id: userId, emoji });
//         if (error) throw error;
//         setImageReactions(prev => ({
//           ...prev,
//           [item.id]: prev[item.id].filter(
//             r => !(r.user_id === userId && r.emoji === emoji),
//           ),
//         }));
//       } else {
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
//           image_id: item.id,
//           user_id: userId,
//           emoji,
//           created_at: new Date().toISOString(),
//         });
//         if (error) throw error;
//         setImageReactions(prev => ({
//           ...prev,
//           [item.id]: [...(prev[item.id] || []), { user_id: userId, emoji }],
//         }));
//       }
//     } catch (e) {
//       setErrorModal({ visible: true, message: 'Failed to update reaction' });
//     }
//   };

//   // Slideshow control
//   const startSlideshowTimer = (reason = 'start') => {
//     if (slideshowTimer.current) clearInterval(slideshowTimer.current);
//     if (!isViewerVisible) {
//       log('[Slideshow] not started. viewerVisible:', isViewerVisible);
//       return;
//     }
//     const total =
//       (viewerFrozenSources.length
//         ? viewerFrozenSources.length
//         : viewerItems.length) || 0;
//     if (total <= 1) {
//       log('[Slideshow] not started. items:', total);
//       return;
//     }
//     slideshowTimer.current = setInterval(() => {
//       try {
//         const next = (currentViewerIndexRef.current + 1) % total;
//         currentViewerIndexRef.current = next;
//         setViewerStartIndex(next);
//         prefetchNeighbors(next);
//       } catch (e) {
//         log('[Slideshow] tick error:', e);
//       }
//     }, slideshowDuration);
//     log('[Slideshow] started:', slideshowDuration, 'ms reason:', reason);
//   };

//   const stopSlideshowTimer = (reason = 'stop') => {
//     if (slideshowTimer.current) {
//       clearInterval(slideshowTimer.current);
//       slideshowTimer.current = null;
//       log('[Slideshow] stopped reason:', reason);
//     }
//   };

//   const promptSlideshowSeconds = () => {
//     setSecondsDraft(
//       Math.max(1, Math.min(30, Math.round(slideshowDuration / 1000))),
//     );
//     setSecondsModalVisible(true);
//   };

//   const confirmSlideshowSeconds = () => {
//     const ms = Math.max(1, Math.min(30, secondsDraft)) * 1000;
//     setSecondsModalVisible(false);
//     setSlideshowDuration(ms);
//     setSlideshowActive(true);
//     startSlideshowTimer('confirm-seconds');
//   };

//   useEffect(() => {
//     if (slideshowActive) startSlideshowTimer('duration-change');
//   }, [slideshowActive, slideshowDuration]);

//   useEffect(() => {
//     return () => {
//       stopSlideshowTimer('unmount');
//       if (swipeResumeTimeoutRef.current)
//         clearTimeout(swipeResumeTimeoutRef.current);
//     };
//   }, []);

//   // Multi-select
//   const toggleSelect = id =>
//     setSelectedIds(prev =>
//       prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id],
//     );
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
//           fetchImages();
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
//       const paths = [];
//       for (const url of urls) {
//         try {
//           const clean = url.split('?')[0];
//           const ext = clean.includes('.') ? clean.split('.').pop() : 'jpg';
//           const path = `${
//             BlobUtil.fs.dirs.CacheDir
//           }/share_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
//           await BlobUtil.config({ path, fileCache: true }).fetch('GET', url);
//           paths.push(`file://${path}`);
//         } catch (e) {}
//       }
//       if (paths.length) await Share.open({ urls: paths, failOnCancel: false });
//       else await Share.open({ urls, failOnCancel: false });
//     } catch {}
//   };
//   const handleBatchFavoriteToggle = async () => {
//     if (!selectedIds.length) return;
//     try {
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
//     } catch (e) {
//       setErrorModal({ visible: true, message: e.message });
//     }
//   };
//   const handleSelectAll = () => {
//     const ids = filteredImages.map(i => i.id);
//     setSelectedIds(ids);
//     setMultiSelect(true);
//   };

//   // Render section
//   const renderSection = (date, imagesArr) => {
//     const showSeeAll = imagesArr.length > 4;
//     const imagesToShow = showSeeAll ? imagesArr.slice(0, 4) : imagesArr;
//     return (
//       <Animated.View
//         key={date}
//         style={[
//           styles.section,
//           { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
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

//   // Header component for ImageViewing (must be a component function)
//   const ViewerHeader = ({ onRequestClose, imageIndex, imageCount }) => {
//     return (
//       <LinearGradient
//         colors={['rgba(0,0,0,0.7)', 'transparent']}
//         style={styles.viewerHeader}
//       >
//         <TouchableOpacity
//           onPress={() => {
//             setIsViewerVisible(false);
//             setViewerFrozenSources([]);
//             if (slideshowActive) {
//               stopSlideshowTimer('viewer-close');
//               setSlideshowActive(false);
//             }
//           }}
//           style={styles.viewerCloseButton}
//         >
//           <Icon name="close" size={28} color="#FFFFFF" />
//         </TouchableOpacity>
//         <View style={styles.viewerHeaderActions}>
//           <TouchableOpacity
//             onPress={() =>
//               slideshowActive
//                 ? (stopSlideshowTimer('toggle-off'), setSlideshowActive(false))
//                 : setSecondsModalVisible(true)
//             }
//             style={styles.viewerHeaderButton}
//           >
//             <Icon
//               name={slideshowActive ? 'pause' : 'play'}
//               size={24}
//               color="#FFFFFF"
//             />
//           </TouchableOpacity>
//           <TouchableOpacity
//             onPress={() => setShowPhotoInfo(v => !v)}
//             style={styles.viewerHeaderButton}
//           >
//             <Icon name="information-circle" size={24} color="#FFFFFF" />
//           </TouchableOpacity>
//         </View>
//       </LinearGradient>
//     );
//   };

//   // Footer component for ImageViewing (receives imageIndex)
//   const ViewerFooter = ({ imageIndex }) => {
//     const item = viewerItems[imageIndex];
//     if (!item) return null;
//     const isVideo = item.type === 'video';
//     const reactions = imageReactions[item.id] || [];
//     return (
//       <View pointerEvents="box-none">
//         {/* Video overlay */}
//         {isVideo && (
//           <View style={styles.videoOverlayContainer} pointerEvents="box-none">
//             <TouchableOpacity
//               onPress={() => openVideoFromViewer(item.image_url)}
//               style={styles.videoOverlayButton}
//               activeOpacity={0.8}
//             >
//               <Icon name="play-circle" size={56} color="#FFFFFF" />
//               <Text style={styles.videoOverlayText}>Tap to play video</Text>
//             </TouchableOpacity>
//           </View>
//         )}

//         {/* Photo info */}
//         {!isVideo && showPhotoInfo && (
//           <LinearGradient
//             colors={['transparent', 'rgba(0,0,0,0.9)']}
//             style={styles.photoInfoPanel}
//           >
//             <Text style={styles.photoInfoTitle}>Photo Details</Text>
//             <Text style={styles.photoInfoText}>
//               Name: {item.file_name || 'Untitled'}
//             </Text>
//             <Text style={styles.photoInfoText}>
//               Date: {format(parseISO(item.created_at), 'PPpp')}
//             </Text>
//             <Text style={styles.photoInfoText}>
//               Storage: {item.storage_type}
//             </Text>
//             <Text style={styles.photoInfoText}>Type: {item.type}</Text>
//           </LinearGradient>
//         )}

//         {/* Reaction picker */}
//         {!isVideo && showReactions && (
//           <View style={styles.reactionsContainer}>
//             <ScrollView horizontal showsHorizontalScrollIndicator={false}>
//               {REACTIONS.map((emoji, idx) => {
//                 const hasReacted = reactions.some(
//                   r => r.user_id === userId && r.emoji === emoji,
//                 );
//                 return (
//                   <TouchableOpacity
//                     key={idx}
//                     onPress={() => toggleReactionForItem(emoji, item)}
//                     style={[
//                       styles.reactionButton,
//                       hasReacted && styles.reactionButtonActive,
//                     ]}
//                   >
//                     <Animated.Text
//                       style={[
//                         styles.reactionEmoji,
//                         { transform: [{ scale: hasReacted ? 1.2 : 1 }] },
//                       ]}
//                     >
//                       {emoji}
//                     </Animated.Text>
//                   </TouchableOpacity>
//                 );
//               })}
//             </ScrollView>
//           </View>
//         )}

//         {/* Reactions display */}
//         {!isVideo && reactions.length > 0 && (
//           <View style={styles.reactionsDisplay}>
//             <View style={styles.reactionsRow}>
//               {reactions.slice(0, 5).map((r, idx) => (
//                 <Text key={idx} style={styles.displayedReaction}>
//                   {r.emoji}
//                 </Text>
//               ))}
//               {reactions.length > 5 && (
//                 <Text style={styles.moreReactions}>
//                   +{reactions.length - 5}
//                 </Text>
//               )}
//             </View>
//           </View>
//         )}

//         {/* Footer actions */}
//         <LinearGradient
//           colors={['transparent', 'rgba(0,0,0,0.8)']}
//           style={styles.viewerFooter}
//         >
//           <TouchableOpacity
//             style={styles.viewerButton}
//             onPress={() => handleShareCurrent(item.image_url, isVideo)}
//           >
//             <Icon name="share-social" size={24} color="#FFFFFF" />
//           </TouchableOpacity>
//           <TouchableOpacity
//             style={styles.viewerButton}
//             onPress={() => handleSaveCurrent(item)}
//           >
//             <Icon name="download" size={24} color="#FFFFFF" />
//           </TouchableOpacity>

//           {!isVideo && (
//             <>
//               <TouchableOpacity
//                 style={styles.viewerButton}
//                 onPress={() => toggleFavoriteItem(item)}
//               >
//                 <Icon
//                   name={item.favorite ? 'heart' : 'heart-outline'}
//                   size={24}
//                   color={
//                     item.favorite ? theme.shared?.red || '#FF5252' : '#FFFFFF'
//                   }
//                 />
//               </TouchableOpacity>
//               <TouchableOpacity
//                 style={styles.viewerButton}
//                 onPress={() => setShowReactions(v => !v)}
//               >
//                 <Icon name="happy" size={24} color="#FFFFFF" />
//               </TouchableOpacity>
//               <TouchableOpacity
//                 style={styles.viewerButton}
//                 onPress={() =>
//                   Alert.alert('Delete', 'Delete this photo?', [
//                     { text: 'Cancel', style: 'cancel' },
//                     {
//                       text: 'Delete',
//                       style: 'destructive',
//                       onPress: async () => {
//                         const { error } = await supabase
//                           .from('images')
//                           .delete()
//                           .eq('id', item.id);
//                         if (error)
//                           setErrorModal({
//                             visible: true,
//                             message: error.message,
//                           });
//                         else {
//                           setIsViewerVisible(false);
//                           setViewerFrozenSources([]);
//                           fetchImages();
//                         }
//                       },
//                     },
//                   ])
//                 }
//               >
//                 <Icon
//                   name="trash"
//                   size={24}
//                   color={theme.shared?.red || '#FF5252'}
//                 />
//               </TouchableOpacity>
//             </>
//           )}
//         </LinearGradient>
//       </View>
//     );
//   };

//   // Loading (after hooks)
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
//               {avatarUrl ? (
//                 <Image source={{ uri: avatarUrl }} style={styles.avatar} />
//               ) : (
//                 <Icon name="person" size={24} color="#FFFFFF" />
//               )}
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
//               <MenuOption
//                 onSelect={() => navigation.navigate('Personalization')}
//               >
//                 <View style={styles.menuOptionContainer}>
//                   <Icon
//                     name="color-palette"
//                     size={20}
//                     color={theme.shared.orange}
//                   />
//                   <Text style={styles.menuOption}>Personalization</Text>
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

//         {/* Search + Filter */}
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
//               placeholder="Search memories..."
//               placeholderTextColor={theme.colors.primary + '60'}
//               value={search}
//               onChangeText={setSearch}
//               selectionColor={theme.colors.primary}
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
//               { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
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

//         {/* Black backdrop under viewer */}
//         {isViewerVisible && (
//           <View pointerEvents="none" style={styles.viewerBackdrop} />
//         )}

//         {/* Media Viewer */}
//         <ImageViewing
//           images={
//             viewerFrozenSources.length ? viewerFrozenSources : viewerSources
//           }
//           imageIndex={viewerStartIndex}
//           visible={isViewerVisible}
//           onRequestClose={() => {
//             setIsViewerVisible(false);
//             setViewerFrozenSources([]);
//             if (slideshowActive) {
//               stopSlideshowTimer('viewer-close');
//               setSlideshowActive(false);
//             }
//           }}
//           backgroundColor="#000"
//           presentationStyle="fullScreen"
//           statusBarTranslucent
//           animationType="none"
//           doubleTapToZoomEnabled
//           swipeToCloseEnabled
//           imageContainerStyle={{ backgroundColor: '#000' }}
//           onImageIndexChange={idx => {
//             currentViewerIndexRef.current = idx;
//             prefetchNeighbors(idx);
//             if (slideshowActive) {
//               pausedByUserSwipeRef.current = true;
//               stopSlideshowTimer('user-swipe');
//               setSlideshowActive(false);
//               if (swipeResumeTimeoutRef.current)
//                 clearTimeout(swipeResumeTimeoutRef.current);
//               swipeResumeTimeoutRef.current = setTimeout(() => {
//                 if (pausedByUserSwipeRef.current) {
//                   pausedByUserSwipeRef.current = false;
//                   setSlideshowActive(true);
//                   startSlideshowTimer('resume-after-swipe');
//                 }
//               }, 600);
//             }
//           }}
//           HeaderComponent={ViewerHeader}
//           FooterComponent={ViewerFooter}
//         />

//         {/* Slideshow seconds modal */}
//         <Modal
//           isVisible={secondsModalVisible}
//           onBackdropPress={() => setSecondsModalVisible(false)}
//           onBackButtonPress={() => setSecondsModalVisible(false)}
//           backdropOpacity={0.5}
//           useNativeDriver
//         >
//           <View style={styles.secondsModal}>
//             <Text style={styles.secondsTitle}>Slideshow interval</Text>
//             <View style={styles.secondsChips}>
//               {SLIDESHOW_DURATIONS.map(d => (
//                 <TouchableOpacity
//                   key={d.value}
//                   style={[
//                     styles.secondsChip,
//                     secondsDraft === d.value / 1000 && styles.secondsChipActive,
//                   ]}
//                   onPress={() => setSecondsDraft(d.value / 1000)}
//                 >
//                   <Text
//                     style={[
//                       styles.secondsChipText,
//                       secondsDraft === d.value / 1000 &&
//                         styles.secondsChipTextActive,
//                     ]}
//                   >
//                     {d.label}
//                   </Text>
//                 </TouchableOpacity>
//               ))}
//             </View>
//             <View style={styles.secondsRow}>
//               <TouchableOpacity
//                 onPress={() => setSecondsDraft(s => Math.max(1, s - 1))}
//                 style={styles.secondsBtn}
//               >
//                 <Icon name="remove" size={22} color="#fff" />
//               </TouchableOpacity>
//               <Text style={styles.secondsValue}>{secondsDraft}s</Text>
//               <TouchableOpacity
//                 onPress={() => setSecondsDraft(s => Math.min(30, s + 1))}
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

//         {/* Video Viewer */}
//         <Modal
//           isVisible={videoVisible}
//           onBackdropPress={closeVideoModal}
//           onBackButtonPress={closeVideoModal}
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
//               onPress={closeVideoModal}
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

// const styles = StyleSheet.create({
//   container: { flex: 1 },
//   loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
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
//   avatarContainer: { marginRight: 12 },
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
//     justifyContent: 'center',
//     alignItems: 'center',
//   },
//   avatar: {
//     width: 40,
//     height: 40,
//     borderRadius: 20,
//     backgroundColor: '#FFF',
//     resizeMode: 'cover',
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

//   searchBar: { marginHorizontal: 16, marginBottom: 12 },
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
//   searchInput: { flex: 1, marginLeft: 12, fontSize: 16 },
//   filterButton: { marginLeft: 8 },
//   filterGradient: {
//     width: 36,
//     height: 36,
//     borderRadius: 18,
//     justifyContent: 'center',
//     alignItems: 'center',
//   },
//   selectButton: { marginLeft: 12 },

//   section: { marginBottom: 24, marginHorizontal: 16 },
//   sectionHeaderGradient: { borderRadius: 12, marginBottom: 12 },
//   sectionHeader: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     alignItems: 'center',
//     paddingVertical: 8,
//     paddingHorizontal: 12,
//   },
//   sectionTitle: { fontSize: 18, fontWeight: 'bold' },
//   seeAllButton: { borderRadius: 16 },
//   seeAllGradient: {
//     paddingHorizontal: 16,
//     paddingVertical: 6,
//     borderRadius: 16,
//   },
//   seeAll: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 14 },

//   fab: { position: 'absolute', right: 24, bottom: 100, zIndex: 10 },
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

//   viewerBackdrop: {
//     ...StyleSheet.absoluteFillObject,
//     backgroundColor: '#000',
//     zIndex: 999,
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
//     marginHorizontal: 4,
//   },

//   videoOverlayContainer: {
//     position: 'absolute',
//     top: '40%',
//     left: 0,
//     right: 0,
//     alignItems: 'center',
//     zIndex: 9,
//   },
//   videoOverlayButton: {
//     alignItems: 'center',
//     justifyContent: 'center',
//     padding: 10,
//   },
//   videoOverlayText: {
//     color: '#fff',
//     marginTop: 8,
//     fontWeight: '600',
//     fontSize: 16,
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
//   photoInfoText: { color: '#FFFFFF', fontSize: 14, marginVertical: 2 },

//   reactionsContainer: {
//     position: 'absolute',
//     bottom: 100,
//     left: 0,
//     right: 0,
//     paddingHorizontal: 20,
//     paddingVertical: 10,
//     backgroundColor: 'transparent',
//   },
//   reactionButton: { paddingHorizontal: 15, paddingVertical: 10 },
//   reactionButtonActive: {
//     backgroundColor: 'rgba(255,255,255,0.2)',
//     borderRadius: 20,
//   },
//   reactionEmoji: { fontSize: 30 },

//   reactionsDisplay: { position: 'absolute', bottom: 160, left: 20 },
//   reactionsRow: { flexDirection: 'row', alignItems: 'center' },
//   displayedReaction: { fontSize: 20, marginRight: 4 },
//   moreReactions: { color: '#FFFFFF', fontSize: 14, marginLeft: 8 },

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
//   dropdownItemActive: { backgroundColor: 'rgba(102, 126, 234, 0.1)' },
//   dropdownText: { marginLeft: 12, fontSize: 15 },

//   secondsModal: { backgroundColor: '#222', padding: 16, borderRadius: 16 },
//   secondsTitle: {
//     color: '#fff',
//     fontWeight: '700',
//     fontSize: 16,
//     marginBottom: 12,
//     textAlign: 'center',
//   },
//   secondsChips: {
//     flexDirection: 'row',
//     flexWrap: 'wrap',
//     justifyContent: 'center',
//   },
//   secondsChip: {
//     paddingHorizontal: 12,
//     paddingVertical: 6,
//     borderRadius: 16,
//     backgroundColor: '#333',
//     margin: 4,
//   },
//   secondsChipActive: { backgroundColor: '#555' },
//   secondsChipText: { color: '#eee', fontSize: 13, fontWeight: '600' },
//   secondsChipTextActive: { color: '#fff' },
//   secondsRow: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     justifyContent: 'center',
//     marginTop: 10,
//   },
//   secondsBtn: {
//     width: 44,
//     height: 44,
//     borderRadius: 22,
//     alignItems: 'center',
//     justifyContent: 'center',
//     backgroundColor: '#444',
//   },
//   secondsValue: {
//     color: '#fff',
//     fontWeight: '700',
//     fontSize: 18,
//     marginHorizontal: 16,
//   },
//   secondsActions: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     marginTop: 16,
//   },
//   secondsActionBtn: {
//     flex: 1,
//     paddingVertical: 10,
//     borderRadius: 12,
//     marginHorizontal: 6,
//     alignItems: 'center',
//   },
//   secondsActionText: { color: '#fff', fontWeight: '700' },

//   videoCloseButton: { position: 'absolute', top: 40, right: 20 },
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
