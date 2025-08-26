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
  TouchableWithoutFeedback,
  UIManager,
  Linking,
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
import CommentsSection from '../components/CommentsSection';
import { useFocusEffect } from '@react-navigation/native';

const log = (...a) => console.log('[Gallery]', ...a);

const IMAGEKIT_LIMIT_GB = 19;
const IMAGEKIT_PUBLIC_KEY = 'public_IAZdw7PGwJlYkHZC8/KN4/9TdRw=';

const FILTERS = [
  { label: 'All', value: 'all' },
  { label: 'Photos', value: 'photo' },
  { label: 'Videos', value: 'video' },
  { label: 'Favorites', value: 'favorites' },
  { label: 'This Month', value: 'month' },
  { label: 'This Week', value: 'week' },
];

const { width } = Dimensions.get('window');

const GalleryScreen = ({ navigation }) => {
  const { theme } = useTheme();

  // Data
  const [images, setImages] = useState([]);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [userId, setUserId] = useState('');

  // UI state
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);

  // Photo viewer
  const [isViewerVisible, setIsViewerVisible] = useState(false);
  const [photoViewerIndex, setPhotoViewerIndex] = useState(0); // index into photosOnly
  const [showFooter, setShowFooter] = useState(true); // visible by default

  // Video viewer
  const [videoVisible, setVideoVisible] = useState(false);
  const [videoUri, setVideoUri] = useState('');

  // Item actions
  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);

  // Comments
  const [showComments, setShowComments] = useState(false);

  // Multi-select
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);

  // Status modals
  const [errorModal, setErrorModal] = useState({ visible: false, message: '' });
  const [successModal, setSuccessModal] = useState({
    visible: false,
    message: '',
  });

  // Detect native video module (prevents RCTVideo crash)
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

  log('Render', {
    loading,
    count: images.length,
    search,
    filter,
    multiSelect,
    selectedIdsLen: selectedIds.length,
    uploading,
    progress,
  });

  // Load auth + avatar
  const fetchProfileAvatar = useCallback(async () => {
    try {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (error) log('getUser error:', error);
      if (!user) return;
      setUserId(user.id);
      const { data, error: pErr } = await supabase
        .from('profiles')
        .select('avatar_url')
        .eq('id', user.id)
        .maybeSingle();
      if (pErr) log('profile fetch error:', pErr);
      setAvatarUrl(data?.avatar_url || '');
      log('Loaded avatar:', data?.avatar_url);
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

  useEffect(() => {
    fetchImages();
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
    return () => {
      supabase.removeChannel(ch);
      log('Realtime channel removed: public:images');
    };
  }, [fetchImages]);

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

            // Edge Function: push notification for new image
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
                log(
                  'Edge function push-new-image-v1 OK. Response:',
                  fnRes,
                  'durationMs:',
                  fnMs,
                );
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
  };

  // Open
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
      setShowComments(false);
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
      setErrorModal({ visible: true, message: e.message });
    }
  };

  const handleSaveCurrent = async () => {
    try {
      const img = photosOnly[photoViewerIndex];
      if (!img) return;
      const fileUrl = img.image_url;
      const fileName = fileUrl.split('/').pop();
      const dirs = BlobUtil.fs.dirs;
      const dest =
        Platform.OS === 'android'
          ? `${dirs.DownloadDir}/${fileName}`
          : `${dirs.DocumentDir}/${fileName}`;
      log('Saving file to device...', { dest, fileUrl });
      await BlobUtil.config({ path: dest }).fetch('GET', fileUrl);
      setSuccessModal({ visible: true, message: 'Saved to device.' });
      log('Saved file to:', dest);
    } catch (e) {
      log('Save error:', e);
      setErrorModal({ visible: true, message: e.message });
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
      <View key={date} style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            {isToday(parseISO(date))
              ? 'Today'
              : format(parseISO(date), 'MMMM d, yyyy')}
          </Text>
          {showSeeAll && (
            <TouchableOpacity
              onPress={() =>
                navigation.navigate('DayGallery', { date, images: imagesArr })
              }
            >
              <Text style={styles.seeAll}>See All</Text>
            </TouchableOpacity>
          )}
        </View>
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
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.loader}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={{ color: theme.colors.text, marginTop: 10 }}>
          Loading gallery...
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[
        styles.container,
        { backgroundColor: theme.colors.primary + '20' },
      ]}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.navigate('Profile')}>
          <Image
            source={
              avatarUrl
                ? { uri: avatarUrl }
                : require('../assets/default-avatar.jpg')
            }
            style={styles.avatar}
          />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Gallery</Text>
        <Menu>
          <MenuTrigger>
            <Icon
              name="ellipsis-vertical"
              size={28}
              color={theme.colors.primary}
            />
          </MenuTrigger>
          <MenuOptions>
            <MenuOption onSelect={() => navigation.navigate('SharedCalendar')}>
              <Text style={styles.menuOption}>Shared Calendar</Text>
            </MenuOption>
            <MenuOption onSelect={() => navigation.navigate('PrivateChat')}>
              <Text style={styles.menuOption}>Private Chat</Text>
            </MenuOption>
            <MenuOption onSelect={() => navigation.navigate('PhotoVault')}>
              <Text style={styles.menuOption}>Photo Vault</Text>
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
              <Text style={[styles.menuOption, { color: '#FF6347' }]}>
                Sign Out
              </Text>
            </MenuOption>
          </MenuOptions>
        </Menu>
      </View>

      {/* Multi-select bar */}
      {multiSelect && (
        <View style={styles.multiSelectBar}>
          <Text style={{ color: theme.colors.primary, fontWeight: 'bold' }}>
            {selectedIds.length} selected
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity
              onPress={handleBatchShare}
              style={{ marginHorizontal: 8 }}
            >
              <Icon
                name="share-social-outline"
                size={22}
                color={theme.colors.primary}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleBatchFavoriteToggle}
              style={{ marginHorizontal: 8 }}
            >
              <Icon name="heart" size={22} color="#FF80AB" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleBatchDelete}
              style={{ marginHorizontal: 8 }}
            >
              <Icon name="trash" size={22} color="#FF6347" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSelectAll}
              style={{ marginHorizontal: 8 }}
            >
              <Icon
                name="checkmark-done"
                size={22}
                color={theme.colors.primary}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setMultiSelect(false);
                setSelectedIds([]);
              }}
              style={{ marginHorizontal: 8 }}
            >
              <Icon name="close" size={22} color="#888" />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Search + Filter + toggle */}
      <View style={styles.searchBar}>
        <Icon name="search" size={20} color="#aaa" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by file or date"
          placeholderTextColor="#aaa"
          value={search}
          onChangeText={t => {
            setSearch(t);
            log('Search changed:', t);
          }}
        />
        <TouchableOpacity onPress={() => setShowFilterDropdown(v => !v)}>
          <Icon name="filter" size={22} color={theme.colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setMultiSelect(v => !v)}
          style={{ marginLeft: 8 }}
        >
          <Icon
            name={multiSelect ? 'checkbox' : 'checkbox-outline'}
            size={22}
            color={theme.colors.primary}
          />
        </TouchableOpacity>
      </View>

      {/* Filter Dropdown */}
      {showFilterDropdown && (
        <View style={styles.dropdown}>
          {FILTERS.map(f => (
            <TouchableOpacity
              key={f.value}
              style={[
                styles.dropdownItem,
                filter === f.value && {
                  backgroundColor: theme.colors.primary + '22',
                },
              ]}
              onPress={() => {
                setFilter(f.value);
                setShowFilterDropdown(false);
                log('Filter set to:', f.value);
              }}
            >
              <Text
                style={{
                  color: theme.colors.primary,
                  fontWeight: filter === f.value ? 'bold' : 'normal',
                }}
              >
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Sections */}
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {Object.keys(groupedImages).map(date =>
          renderSection(date, groupedImages[date]),
        )}
      </ScrollView>

      {/* Upload FAB */}
      <TouchableOpacity style={styles.fab} onPress={handleImagePickAndUpload}>
        <Icon name="add" size={30} color="#fff" />
      </TouchableOpacity>

      {/* Upload Progress */}
      {uploading && (
        <View style={styles.uploadStatus}>
          <ActivityIndicator color="white" />
          <Text style={styles.uploadText}>Uploading... {progress}%</Text>
        </View>
      )}

      {/* Photo Viewer */}
      <ImageViewing
        images={photosOnly.map(img => ({ uri: img.image_url }))}
        imageIndex={photoViewerIndex}
        visible={isViewerVisible}
        onRequestClose={() => setIsViewerVisible(false)}
        doubleTapToZoomEnabled
        swipeToCloseEnabled
        onImageIndexChange={() => {
          setShowFooter(true);
          setShowComments(false);
        }}
        imageContainerStyle={{ marginBottom: showFooter ? 180 : 0 }}
        FooterComponent={() => {
          const img = photosOnly[photoViewerIndex];
          if (!img) return null;
          return (
            <View>
              <View style={styles.viewerFooter}>
                <TouchableOpacity
                  style={styles.viewerButton}
                  onPress={handleShareCurrent}
                >
                  <Icon name="share-social-outline" size={22} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.viewerButton}
                  onPress={handleSaveCurrent}
                >
                  <Icon name="download-outline" size={22} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.viewerButton}
                  onPress={toggleFavoriteCurrent}
                >
                  <Icon
                    name={img.favorite ? 'heart' : 'heart-outline'}
                    size={22}
                    color="#FF80AB"
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.viewerButton}
                  onPress={deleteCurrentPhoto}
                >
                  <Icon name="trash-outline" size={22} color="#FF6347" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.viewerButton}
                  onPress={() => setShowComments(v => !v)}
                >
                  <Icon
                    name="chatbubble-ellipses-outline"
                    size={22}
                    color="#fff"
                  />
                </TouchableOpacity>
              </View>
              {showComments && (
                <CommentsSection
                  imageId={img.id}
                  userId={userId}
                  theme={theme}
                />
              )}
            </View>
          );
        }}
      />

      {/* Video Viewer (dedicated) */}
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
            style={{
              position: 'absolute',
              top: 20,
              right: 20,
              backgroundColor: 'rgba(0,0,0,0.5)',
              padding: 8,
              borderRadius: 18,
            }}
          >
            <Icon name="close" size={22} color="#fff" />
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
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFF0F6',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    justifyContent: 'space-between',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: '#eee',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#FF80AB',
    textAlign: 'left',
    flex: 1,
  },
  menuOption: { fontSize: 16, padding: 10, color: '#222' },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 10,
    marginBottom: 10,
    elevation: 2,
  },
  searchInput: { flex: 1, marginLeft: 10, color: '#333' },

  section: { marginBottom: 24 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#222' },
  seeAll: { color: '#FF6347', fontWeight: 'bold' },

  fab: {
    position: 'absolute',
    right: 30,
    bottom: 100,
    backgroundColor: '#FF80AB',
    borderRadius: 30,
    width: 60,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    zIndex: 10,
  },
  uploadStatus: {
    position: 'absolute',
    bottom: 100,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 10,
  },
  uploadText: { marginLeft: 10, fontSize: 16, color: 'white' },

  multiSelectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 8,
    marginBottom: 8,
    marginHorizontal: 4,
    elevation: 2,
    justifyContent: 'space-between',
  },

  // Viewer footer
  viewerFooter: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    width: '100%',
    position: 'absolute',
    bottom: 0,
  },
  viewerButton: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginHorizontal: 2,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 44,
  },

  dropdown: {
    position: 'absolute',
    top: 110,
    right: 16,
    zIndex: 10,
    backgroundColor: '#fff',
    borderRadius: 12,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    minWidth: 140,
  },
  dropdownItem: {
    padding: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: '#eee',
  },
});

export default GalleryScreen;

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
//   TouchableWithoutFeedback,
//   UIManager,
//   Linking,
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

// const log = (...a) => console.log('[Gallery]', ...a);

// const IMAGEKIT_LIMIT_GB = 19;
// const IMAGEKIT_PUBLIC_KEY = 'public_IAZdw7PGwJlYkHZC8/KN4/9TdRw=';

// const FILTERS = [
//   { label: 'All', value: 'all' },
//   { label: 'Photos', value: 'photo' },
//   { label: 'Videos', value: 'video' },
//   { label: 'Favorites', value: 'favorites' },
//   { label: 'This Month', value: 'month' },
//   { label: 'This Week', value: 'week' },
// ];

// const { width } = Dimensions.get('window');

// const GalleryScreen = ({ navigation }) => {
//   const { theme } = useTheme();

//   // Data
//   const [images, setImages] = useState([]);
//   const [avatarUrl, setAvatarUrl] = useState('');
//   const [userId, setUserId] = useState('');

//   // UI state
//   const [loading, setLoading] = useState(true);
//   const [refreshing, setRefreshing] = useState(false);
//   const [uploading, setUploading] = useState(false);
//   const [progress, setProgress] = useState(0);

//   const [search, setSearch] = useState('');
//   const [filter, setFilter] = useState('all');
//   const [showFilterDropdown, setShowFilterDropdown] = useState(false);

//   // Photo viewer
//   const [isViewerVisible, setIsViewerVisible] = useState(false);
//   const [photoViewerIndex, setPhotoViewerIndex] = useState(0); // index into photosOnly
//   const [showFooter, setShowFooter] = useState(true); // visible by default

//   // Video viewer
//   const [videoVisible, setVideoVisible] = useState(false);
//   const [videoUri, setVideoUri] = useState('');

//   // Item actions
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

//   // Detect native video module (prevents RCTVideo crash)
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
//       if (!user) return;
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
//       log('Supabase fetch success. Images:', data?.length);
//     } catch (e) {
//       log('Fetch error:', e);
//       setErrorModal({ visible: true, message: e.message || String(e) });
//       setImages([]);
//     } finally {
//       setLoading(false);
//       setRefreshing(false);
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
//     launchImageLibrary(
//       { mediaType: 'mixed', selectionLimit: 0 },
//       async response => {
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

//           const usageRes = await fetch(
//             'https://boyfriend-needs-backend.vercel.app/api/imagekit-usage',
//           );
//           const usage = await usageRes.json();
//           const useImageKit = usage?.totalGB < IMAGEKIT_LIMIT_GB;
//           log('Upload will use:', useImageKit ? 'ImageKit' : 'Cloudinary');

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
//             setProgress(0);
//             const isVideo = asset.type?.startsWith('video');
//             const type = isVideo ? 'video' : 'photo';

//             let uploadUrl = '';
//             let storageType = '';

//             if (useImageKit) {
//               try {
//                 const signatureData = await fetch(
//                   'https://boyfriend-needs-backend.vercel.app/api/imagekit-auth',
//                 ).then(res => res.json());
//                 log('Got ImageKit signature for asset', i);

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
//                 if (uploadResult.info().status >= 300)
//                   throw new Error(
//                     resultJson?.message || 'ImageKit upload failed',
//                   );

//                 uploadUrl = resultJson.url;
//                 storageType = 'imagekit';
//                 log('ImageKit upload success:', uploadUrl);
//               } catch (e) {
//                 log(
//                   'ImageKit upload error, fallback to Cloudinary:',
//                   e?.message || e,
//                 );
//                 const fileBase64 = await BlobUtil.fs.readFile(
//                   (asset.uri || '').replace('file://', ''),
//                   'base64',
//                 );
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
//                 log('Cloudinary upload success:', uploadUrl);
//               }
//             } else {
//               const fileBase64 = await BlobUtil.fs.readFile(
//                 (asset.uri || '').replace('file://', ''),
//                 'base64',
//               );
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
//               log('Cloudinary upload success:', uploadUrl);
//             }

//             // Insert row
//             const { error: sErr } = await supabase.from('images').insert({
//               user_id: user.id,
//               image_url: uploadUrl,
//               storage_type: storageType,
//               created_at: new Date().toISOString(),
//               file_name: asset.fileName || '',
//               favorite: false,
//               type,
//               private: false,
//             });

//             if (sErr) {
//               log('Supabase insert error:', sErr);
//               setErrorModal({ visible: true, message: sErr.message });
//               break;
//             }
//             successCount++;
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
//         }
//       },
//     );
//   };

//   const onRefresh = () => {
//     setRefreshing(true);
//     fetchImages();
//   };

//   // Open
//   const openItem = item => {
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
//     }
//   };

//   // Multi-select helpers
//   const toggleSelect = id => {
//     setSelectedIds(prev =>
//       prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id],
//     );
//   };

//   const startMultiSelect = id => {
//     if (!multiSelect) setMultiSelect(true);
//     toggleSelect(id);
//     log('Multi-select start/toggle id:', id);
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
//     }
//   };

//   const handleSelectAll = () => {
//     const ids = filteredImages.map(i => i.id);
//     setSelectedIds(ids);
//     setMultiSelect(true);
//     log('Selected all:', ids.length);
//   };

//   // Render each date section
//   const renderSection = (date, imagesArr) => (
//     <View key={date} style={styles.section}>
//       <View style={styles.sectionHeader}>
//         <Text style={styles.sectionTitle}>
//           {isToday(parseISO(date))
//             ? 'Today'
//             : format(parseISO(date), 'MMMM d, yyyy')}
//         </Text>
//         <TouchableOpacity
//           onPress={() =>
//             navigation.navigate('DayGallery', { date, images: imagesArr })
//           }
//         >
//           <Text style={styles.seeAll}>See All</Text>
//         </TouchableOpacity>
//       </View>
//       <FlatList
//         data={imagesArr}
//         numColumns={2}
//         keyExtractor={item => item.id.toString()}
//         scrollEnabled={false}
//         renderItem={({ item }) => (
//           <PhotoGridItem
//             image={item}
//             onPress={() => openItem(item)}
//             onLongPress={() => startMultiSelect(item.id)} // <-- requires small patch below in PhotoGridItem
//             selected={selectedIds.includes(item.id)}
//             showSelect={multiSelect}
//           />
//         )}
//       />
//     </View>
//   );

//   if (loading) {
//     return (
//       <SafeAreaView style={styles.loader}>
//         <ActivityIndicator size="large" color={theme.colors.primary} />
//         <Text style={{ color: theme.colors.text, marginTop: 10 }}>
//           Loading gallery...
//         </Text>
//       </SafeAreaView>
//     );
//   }

//   return (
//     <SafeAreaView
//       style={[
//         styles.container,
//         { backgroundColor: theme.colors.primary + '20' },
//       ]}
//     >
//       {/* Header */}
//       <View style={styles.header}>
//         <TouchableOpacity onPress={() => navigation.navigate('Profile')}>
//           <Image
//             source={
//               avatarUrl
//                 ? { uri: avatarUrl }
//                 : require('../assets/default-avatar.jpg')
//             }
//             style={styles.avatar}
//           />
//         </TouchableOpacity>
//         <Text style={styles.headerTitle}>Gallery</Text>
//         <Menu>
//           <MenuTrigger>
//             <Icon
//               name="ellipsis-vertical"
//               size={28}
//               color={theme.colors.primary}
//             />
//           </MenuTrigger>
//           <MenuOptions>
//             <MenuOption onSelect={() => navigation.navigate('SharedCalendar')}>
//               <Text style={styles.menuOption}>Shared Calendar</Text>
//             </MenuOption>
//             <MenuOption onSelect={() => navigation.navigate('PrivateChat')}>
//               <Text style={styles.menuOption}>Private Chat</Text>
//             </MenuOption>
//             <MenuOption onSelect={() => navigation.navigate('PhotoVault')}>
//               <Text style={styles.menuOption}>Photo Vault</Text>
//             </MenuOption>
//             <MenuOption
//               onSelect={async () => {
//                 await supabase.auth.signOut();
//                 navigation.reset({
//                   index: 0,
//                   routes: [{ name: 'ProfileSelector' }],
//                 });
//               }}
//             >
//               <Text style={[styles.menuOption, { color: '#FF6347' }]}>
//                 Sign Out
//               </Text>
//             </MenuOption>
//           </MenuOptions>
//         </Menu>
//       </View>

//       {/* Multi-select bar */}
//       {multiSelect && (
//         <View style={styles.multiSelectBar}>
//           <Text style={{ color: theme.colors.primary, fontWeight: 'bold' }}>
//             {selectedIds.length} selected
//           </Text>
//           <View style={{ flexDirection: 'row', alignItems: 'center' }}>
//             <TouchableOpacity
//               onPress={handleBatchShare}
//               style={{ marginHorizontal: 8 }}
//             >
//               <Icon
//                 name="share-social-outline"
//                 size={22}
//                 color={theme.colors.primary}
//               />
//             </TouchableOpacity>
//             <TouchableOpacity
//               onPress={handleBatchFavoriteToggle}
//               style={{ marginHorizontal: 8 }}
//             >
//               <Icon name="heart" size={22} color="#FF80AB" />
//             </TouchableOpacity>
//             <TouchableOpacity
//               onPress={handleBatchDelete}
//               style={{ marginHorizontal: 8 }}
//             >
//               <Icon name="trash" size={22} color="#FF6347" />
//             </TouchableOpacity>
//             <TouchableOpacity
//               onPress={handleSelectAll}
//               style={{ marginHorizontal: 8 }}
//             >
//               <Icon
//                 name="checkmark-done"
//                 size={22}
//                 color={theme.colors.primary}
//               />
//             </TouchableOpacity>
//             <TouchableOpacity
//               onPress={() => {
//                 setMultiSelect(false);
//                 setSelectedIds([]);
//               }}
//               style={{ marginHorizontal: 8 }}
//             >
//               <Icon name="close" size={22} color="#888" />
//             </TouchableOpacity>
//           </View>
//         </View>
//       )}

//       {/* Search + Filter + toggle */}
//       <View style={styles.searchBar}>
//         <Icon name="search" size={20} color="#aaa" />
//         <TextInput
//           style={styles.searchInput}
//           placeholder="Search by file or date"
//           placeholderTextColor="#aaa"
//           value={search}
//           onChangeText={t => {
//             setSearch(t);
//             log('Search changed:', t);
//           }}
//         />
//         <TouchableOpacity onPress={() => setShowFilterDropdown(v => !v)}>
//           <Icon name="filter" size={22} color={theme.colors.primary} />
//         </TouchableOpacity>
//         <TouchableOpacity
//           onPress={() => setMultiSelect(v => !v)}
//           style={{ marginLeft: 8 }}
//         >
//           <Icon
//             name={multiSelect ? 'checkbox' : 'checkbox-outline'}
//             size={22}
//             color={theme.colors.primary}
//           />
//         </TouchableOpacity>
//       </View>

//       {/* Filter Dropdown */}
//       {showFilterDropdown && (
//         <View style={styles.dropdown}>
//           {FILTERS.map(f => (
//             <TouchableOpacity
//               key={f.value}
//               style={[
//                 styles.dropdownItem,
//                 filter === f.value && {
//                   backgroundColor: theme.colors.primary + '22',
//                 },
//               ]}
//               onPress={() => {
//                 setFilter(f.value);
//                 setShowFilterDropdown(false);
//                 log('Filter set to:', f.value);
//               }}
//             >
//               <Text
//                 style={{
//                   color: theme.colors.primary,
//                   fontWeight: filter === f.value ? 'bold' : 'normal',
//                 }}
//               >
//                 {f.label}
//               </Text>
//             </TouchableOpacity>
//           ))}
//         </View>
//       )}

//       {/* Sections */}
//       <ScrollView
//         contentContainerStyle={{ paddingBottom: 120 }}
//         refreshControl={
//           <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
//         }
//       >
//         {Object.keys(groupedImages).map(date =>
//           renderSection(date, groupedImages[date]),
//         )}
//       </ScrollView>

//       {/* Upload FAB */}
//       <TouchableOpacity style={styles.fab} onPress={handleImagePickAndUpload}>
//         <Icon name="add" size={30} color="#fff" />
//       </TouchableOpacity>

//       {/* Upload Progress */}
//       {uploading && (
//         <View style={styles.uploadStatus}>
//           <ActivityIndicator color="white" />
//           <Text style={styles.uploadText}>Uploading... {progress}%</Text>
//         </View>
//       )}

//       {/* Photo Viewer */}
//       <ImageViewing
//         images={photosOnly.map(img => ({ uri: img.image_url }))}
//         imageIndex={photoViewerIndex}
//         visible={isViewerVisible}
//         onRequestClose={() => setIsViewerVisible(false)}
//         doubleTapToZoomEnabled
//         swipeToCloseEnabled
//         onImageIndexChange={() => {
//           setShowFooter(true);
//           setShowComments(false);
//         }}
//         imageContainerStyle={{ marginBottom: showFooter ? 180 : 0 }}
//         FooterComponent={() => {
//           const img = photosOnly[photoViewerIndex];
//           if (!img) return null;
//           return (
//             <View>
//               <View style={styles.viewerFooter}>
//                 <TouchableOpacity
//                   style={styles.viewerButton}
//                   onPress={handleShareCurrent}
//                 >
//                   <Icon name="share-social-outline" size={22} color="#fff" />
//                 </TouchableOpacity>
//                 <TouchableOpacity
//                   style={styles.viewerButton}
//                   onPress={handleSaveCurrent}
//                 >
//                   <Icon name="download-outline" size={22} color="#fff" />
//                 </TouchableOpacity>
//                 <TouchableOpacity
//                   style={styles.viewerButton}
//                   onPress={toggleFavoriteCurrent}
//                 >
//                   <Icon
//                     name={img.favorite ? 'heart' : 'heart-outline'}
//                     size={22}
//                     color="#FF80AB"
//                   />
//                 </TouchableOpacity>
//                 <TouchableOpacity
//                   style={styles.viewerButton}
//                   onPress={deleteCurrentPhoto}
//                 >
//                   <Icon name="trash-outline" size={22} color="#FF6347" />
//                 </TouchableOpacity>
//                 <TouchableOpacity
//                   style={styles.viewerButton}
//                   onPress={() => setShowComments(v => !v)}
//                 >
//                   <Icon
//                     name="chatbubble-ellipses-outline"
//                     size={22}
//                     color="#fff"
//                   />
//                 </TouchableOpacity>
//               </View>
//               {showComments && (
//                 <CommentsSection
//                   imageId={img.id}
//                   userId={userId}
//                   theme={theme}
//                 />
//               )}
//             </View>
//           );
//         }}
//       />

//       {/* Video Viewer (dedicated) */}
//       <Modal
//         isVisible={videoVisible}
//         onBackdropPress={() => setVideoVisible(false)}
//         onBackButtonPress={() => setVideoVisible(false)}
//         style={{ margin: 0 }}
//         useNativeDriver
//         hideModalContentWhileAnimating
//       >
//         <View style={{ flex: 1, backgroundColor: '#000' }}>
//           <Video
//             source={{ uri: videoUri }}
//             style={{ width: '100%', height: '100%' }}
//             controls
//             paused={false}
//             resizeMode="contain"
//             onError={e => log('Video error:', e)}
//             onLoad={meta => log('Video loaded duration:', meta.duration)}
//             posterResizeMode="cover"
//           />
//           <TouchableOpacity
//             onPress={() => setVideoVisible(false)}
//             style={{
//               position: 'absolute',
//               top: 20,
//               right: 20,
//               backgroundColor: 'rgba(0,0,0,0.5)',
//               padding: 8,
//               borderRadius: 18,
//             }}
//           >
//             <Icon name="close" size={22} color="#fff" />
//           </TouchableOpacity>
//         </View>
//       </Modal>

//       {/* Error & Success */}
//       <ErrorModal
//         visible={errorModal.visible}
//         message={errorModal.message}
//         onClose={() => setErrorModal({ visible: false, message: '' })}
//         theme={theme}
//       />
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
//   loader: {
//     flex: 1,
//     justifyContent: 'center',
//     alignItems: 'center',
//     backgroundColor: '#FFF0F6',
//   },

//   header: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     marginBottom: 10,
//     justifyContent: 'space-between',
//   },
//   avatar: {
//     width: 36,
//     height: 36,
//     borderRadius: 18,
//     marginRight: 10,
//     borderWidth: 2,
//     borderColor: '#fff',
//     backgroundColor: '#eee',
//   },
//   headerTitle: {
//     fontSize: 22,
//     fontWeight: 'bold',
//     color: '#FF80AB',
//     textAlign: 'left',
//     flex: 1,
//   },
//   menuOption: { fontSize: 16, padding: 10, color: '#222' },

//   searchBar: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     backgroundColor: '#fff',
//     borderRadius: 20,
//     padding: 10,
//     marginBottom: 10,
//     elevation: 2,
//   },
//   searchInput: { flex: 1, marginLeft: 10, color: '#333' },

//   section: { marginBottom: 24 },
//   sectionHeader: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     alignItems: 'center',
//     marginBottom: 8,
//   },
//   sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#222' },
//   seeAll: { color: '#FF6347', fontWeight: 'bold' },

//   fab: {
//     position: 'absolute',
//     right: 30,
//     bottom: 100,
//     backgroundColor: '#FF80AB',
//     borderRadius: 30,
//     width: 60,
//     height: 60,
//     justifyContent: 'center',
//     alignItems: 'center',
//     elevation: 8,
//     shadowColor: '#000',
//     shadowOpacity: 0.2,
//     shadowRadius: 8,
//     shadowOffset: { width: 0, height: 4 },
//     zIndex: 10,
//   },
//   uploadStatus: {
//     position: 'absolute',
//     bottom: 100,
//     alignSelf: 'center',
//     backgroundColor: 'rgba(0,0,0,0.7)',
//     paddingVertical: 10,
//     paddingHorizontal: 20,
//     borderRadius: 20,
//     flexDirection: 'row',
//     alignItems: 'center',
//     zIndex: 10,
//   },
//   uploadText: { marginLeft: 10, fontSize: 16, color: 'white' },

//   multiSelectBar: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     backgroundColor: '#fff',
//     borderRadius: 16,
//     padding: 8,
//     marginBottom: 8,
//     marginHorizontal: 4,
//     elevation: 2,
//     justifyContent: 'space-between',
//   },

//   // Viewer footer
//   viewerFooter: {
//     flexDirection: 'row',
//     justifyContent: 'center',
//     alignItems: 'center',
//     marginBottom: 24,
//     width: '100%',
//     position: 'absolute',
//     bottom: 0,
//   },
//   viewerButton: {
//     backgroundColor: 'rgba(0,0,0,0.6)',
//     paddingVertical: 10,
//     paddingHorizontal: 10,
//     borderRadius: 8,
//     marginHorizontal: 2,
//     flexDirection: 'row',
//     alignItems: 'center',
//     minWidth: 44,
//   },

//   dropdown: {
//     position: 'absolute',
//     top: 110,
//     right: 16,
//     zIndex: 10,
//     backgroundColor: '#fff',
//     borderRadius: 12,
//     elevation: 8,
//     shadowColor: '#000',
//     shadowOpacity: 0.1,
//     shadowRadius: 8,
//     shadowOffset: { width: 0, height: 4 },
//     minWidth: 140,
//   },
//   dropdownItem: {
//     padding: 14,
//     borderBottomWidth: 0.5,
//     borderBottomColor: '#eee',
//   },
// });

// export default GalleryScreen;
