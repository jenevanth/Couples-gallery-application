import React, { useState, useEffect, useCallback } from 'react';
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
import { format, parseISO, isToday, isSameMonth, isSameWeek } from 'date-fns';

const IMAGEKIT_LIMIT_GB = 19;
const IMAGEKIT_PUBLIC_KEY = 'public_IAZdw7PGwJlYkHZC8/KN4/9TdRw=';

const FILTERS = [
  { label: 'All', value: 'all' },
  { label: 'This Month', value: 'month' },
  { label: 'This Week', value: 'week' },
];

const GalleryScreen = ({ navigation }) => {
  const { theme, setCurrentTheme } = useTheme();
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isViewerVisible, setIsViewerVisible] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [fetchError, setFetchError] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [errorModal, setErrorModal] = useState({ visible: false, message: '' });
  const [successModal, setSuccessModal] = useState({
    visible: false,
    message: '',
  });

  // Debug log for every render
  console.log('[GalleryScreen] Render', {
    loading,
    imagesCount: images.length,
    search,
    filter,
  });

  // Fetch images from Supabase
  const fetchImages = useCallback(async () => {
    console.log('[GalleryScreen] --- Fetching images from Supabase... ---');
    setLoading(true);
    setFetchError(null);
    const { data, error } = await supabase
      .from('images')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      setFetchError(error.message);
      setErrorModal({ visible: true, message: error.message });
      setImages([]);
    } else {
      setImages(data || []);
      console.log(
        '[GalleryScreen] Supabase fetch success. Images:',
        data?.length,
        data,
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchImages();
    const imagesChannel = supabase
      .channel('public:images')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'images' },
        payload => {
          console.log(
            '[GalleryScreen] --- Supabase real-time event received ---',
            payload.eventType,
          );
          fetchImages();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(imagesChannel);
    };
  }, [fetchImages]);

  // Group images by date
  const groupImagesByDate = imagesArr => {
    const groups = {};
    imagesArr.forEach(img => {
      const date = format(parseISO(img.created_at), 'yyyy-MM-dd');
      if (!groups[date]) groups[date] = [];
      groups[date].push(img);
    });
    return groups;
  };

  // Filter images by search and filter
  const getFilteredImages = () => {
    let filtered = images;
    if (search) {
      filtered = filtered.filter(
        img =>
          (img.image_url &&
            img.image_url.toLowerCase().includes(search.toLowerCase())) ||
          (img.file_name &&
            img.file_name.toLowerCase().includes(search.toLowerCase())),
      );
    }
    if (filter === 'month') {
      filtered = filtered.filter(img =>
        isSameMonth(parseISO(img.created_at), new Date()),
      );
    } else if (filter === 'week') {
      filtered = filtered.filter(img =>
        isSameWeek(parseISO(img.created_at), new Date(), { weekStartsOn: 1 }),
      );
    }
    return filtered;
  };

  // Upload handler (ImageKit until full, then Cloudinary)
  const handleImagePickAndUpload = () => {
    launchImageLibrary(
      { mediaType: 'photo', selectionLimit: 0 },
      async response => {
        if (response.didCancel) return;
        if (response.errorCode) {
          setErrorModal({ visible: true, message: response.errorMessage });
          return;
        }
        const assets = response.assets;
        if (!assets || assets.length === 0) return;
        setUploading(true);
        let successCount = 0;
        const usageRes = await fetch(
          'https://boyfriend-needs-backend.vercel.app/api/imagekit-usage',
        );
        const usage = await usageRes.json();
        const useImageKit = usage.totalGB < IMAGEKIT_LIMIT_GB;
        for (let i = 0; i < assets.length; i++) {
          const asset = assets[i];
          setProgress(0);
          try {
            let uploadUrl = '',
              storageType = '';
            if (useImageKit) {
              const signatureData = await fetch(
                'https://boyfriend-needs-backend.vercel.app/api/imagekit-auth',
              ).then(res => res.json());
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
              task.uploadProgress((written, total) =>
                setProgress(Math.round((written / total) * 100)),
              );
              const uploadResult = await task;
              const resultJson = uploadResult.json();
              if (uploadResult.info().status >= 300)
                throw new Error(resultJson.message || 'ImageKit upload failed');
              uploadUrl = resultJson.url;
              storageType = 'imagekit';
              console.log(
                '[GalleryScreen] ImageKit upload success:',
                uploadUrl,
              );
            } else {
              const fileBase64 = await BlobUtil.fs.readFile(
                asset.uri.replace('file://', ''),
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
              const cloudJson = await cloudRes.json();
              if (!cloudJson.url) throw new Error('Cloudinary upload failed');
              uploadUrl = cloudJson.url;
              storageType = 'cloudinary';
              console.log(
                '[GalleryScreen] Cloudinary upload success:',
                uploadUrl,
              );
            }
            // Save to Supabase
            const {
              data: { user },
            } = await supabase.auth.getUser();
            const { error: supabaseError } = await supabase
              .from('images')
              .insert({
                user_id: user.id,
                image_url: uploadUrl,
                storage_type: storageType,
                created_at: new Date().toISOString(),
                file_name: asset.fileName,
                favorite: false,
              });
            if (supabaseError) {
              setErrorModal({ visible: true, message: supabaseError.message });
              break;
            }
            successCount++;
          } catch (e) {
            setErrorModal({ visible: true, message: e.message });
            break;
          }
        }
        setUploading(false);
        if (successCount > 0) {
          setSuccessModal({
            visible: true,
            message: `${successCount} photo(s) uploaded!`,
          });
        }
        fetchImages();
      },
    );
  };

  // Fullscreen viewer actions
  const handleShare = async () => {
    try {
      const image = getFilteredImages()[currentIndex];
      if (!image) return;
      await Share.open({ url: image.image_url });
      console.log('[GalleryScreen] Shared image:', image.image_url);
    } catch (e) {
      setErrorModal({ visible: true, message: e.message });
    }
  };

  const handleSave = async () => {
    try {
      const image = getFilteredImages()[currentIndex];
      if (!image) return;
      const fileUrl = image.image_url;
      const fileName = fileUrl.split('/').pop();
      const dirs = BlobUtil.fs.dirs;
      const downloadDest =
        Platform.OS === 'android'
          ? `${dirs.DownloadDir}/${fileName}`
          : `${dirs.DocumentDir}/${fileName}`;
      await BlobUtil.config({ path: downloadDest }).fetch('GET', fileUrl);
      setSuccessModal({
        visible: true,
        message: 'Image saved to your device.',
      });
      console.log('[GalleryScreen] Saved image to device:', downloadDest);
    } catch (e) {
      setErrorModal({ visible: true, message: e.message });
    }
  };

  const handleToggleFavorite = async image => {
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
      console.log(
        '[GalleryScreen] Toggled favorite for image:',
        image.id,
        'Now:',
        updated,
      );
    } catch (e) {
      setErrorModal({ visible: true, message: e.message });
    }
  };

  const openDeleteModal = image => {
    setSelectedImage(image);
    setIsDeleteModalVisible(true);
    console.log('[GalleryScreen] Opened delete modal for image:', image.id);
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
      } else {
        setIsDeleteModalVisible(false);
        setSelectedImage(null);
        fetchImages();
        console.log('[GalleryScreen] Deleted image:', selectedImage.id);
      }
    } catch (e) {
      setErrorModal({ visible: true, message: e.message });
    }
  };

  // Render each date section
  const renderSection = (date, imagesArr) => (
    <View key={date} style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          {isToday(parseISO(date))
            ? 'Today'
            : format(parseISO(date), 'MMMM d, yyyy')}
        </Text>
        <TouchableOpacity
          onPress={() =>
            navigation.navigate('DayGallery', { date, images: imagesArr })
          }
        >
          <Text style={styles.seeAll}>See All</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={imagesArr}
        numColumns={2}
        keyExtractor={item => item.id.toString()}
        renderItem={({ item, index }) => (
          <PhotoGridItem
            image={item}
            onPress={() => {
              const idx = getFilteredImages().findIndex(
                img => img.id === item.id,
              );
              setCurrentIndex(idx);
              setIsViewerVisible(true);
              console.log(
                '[GalleryScreen] Opened viewer for image:',
                item.id,
                'at index',
                idx,
              );
            }}
          />
        )}
        scrollEnabled={false}
      />
    </View>
  );

  // UI rendering
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

  if (fetchError) {
    return (
      <SafeAreaView style={styles.loader}>
        <Text style={{ color: 'red', marginBottom: 10 }}>
          Error: {fetchError}
        </Text>
        <TouchableOpacity onPress={fetchImages} style={styles.fab}>
          <Text style={styles.fabIcon}>⟳</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // Group and filter images
  const filteredImages = getFilteredImages();
  const groupedImages = groupImagesByDate(filteredImages);

  return (
    <SafeAreaView
      style={[
        styles.container,
        { backgroundColor: theme.colors.primary + '20' },
      ]}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() =>
            setCurrentTheme(theme.name === 'pink' ? 'blue' : 'pink')
          }
        >
          <Icon name="person-circle" size={40} color={theme.colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Gallery</Text>
        <TouchableOpacity
          onPress={() => setShowFilterDropdown(!showFilterDropdown)}
        >
          <Icon name="filter" size={28} color={theme.colors.primary} />
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
                console.log('[GalleryScreen] Filter set to:', f.value);
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
      {/* Search */}
      <View style={styles.searchBar}>
        <Icon name="search" size={20} color="#aaa" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by file or date"
          placeholderTextColor="#aaa"
          value={search}
          onChangeText={text => {
            setSearch(text);
            console.log('[GalleryScreen] Search changed:', text);
          }}
        />
      </View>
      {/* Date sections */}
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
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
      {/* Image Viewer */}
      <ImageViewing
        images={filteredImages.map(img => ({ uri: img.image_url }))}
        imageIndex={currentIndex}
        visible={isViewerVisible}
        onRequestClose={() => setIsViewerVisible(false)}
        FooterComponent={() => {
          const image = filteredImages[currentIndex];
          if (!image) return null;
          return (
            <View style={styles.viewerFooter}>
              <TouchableOpacity
                style={styles.viewerButton}
                onPress={handleShare}
              >
                <Icon name="share-social-outline" size={22} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.viewerButton}
                onPress={handleSave}
              >
                <Icon name="download-outline" size={22} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.viewerButton}
                onPress={() => handleToggleFavorite(image)}
              >
                <Icon
                  name={image.favorite ? 'heart' : 'heart-outline'}
                  size={22}
                  color="#FF80AB"
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.viewerButton}
                onPress={() => openDeleteModal(image)}
              >
                <Icon name="trash-outline" size={22} color="#FF6347" />
              </TouchableOpacity>
            </View>
          );
        }}
      />
      {/* Delete Modal */}
      <Modal isVisible={isDeleteModalVisible}>
        <View style={styles.modalContent}>
          <Text
            style={{
              color: theme.colors.primary,
              fontSize: 18,
              marginBottom: 20,
            }}
          >
            Are you sure you want to delete this photo?
          </Text>
          <View style={{ flexDirection: 'row' }}>
            <TouchableOpacity style={styles.modalButton} onPress={handleDelete}>
              <Text style={{ color: '#fff' }}>Delete</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => setIsDeleteModalVisible(false)}
            >
              <Text style={{ color: '#fff' }}>Cancel</Text>
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
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#FF80AB',
    textAlign: 'center',
    flex: 1,
  },
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
  },
  uploadText: { marginLeft: 10, fontSize: 16, color: 'white' },
  modalContent: {
    backgroundColor: '#fff',
    padding: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalButton: {
    backgroundColor: '#FF80AB',
    padding: 12,
    borderRadius: 8,
    marginHorizontal: 10,
    minWidth: 80,
    alignItems: 'center',
  },
  viewerFooter: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 40,
    width: '100%',
    position: 'absolute',
    bottom: 0,
  },
  viewerButton: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginHorizontal: 10,
  },
  dropdown: {
    position: 'absolute',
    top: 60,
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

// import React, { useState, useEffect, useCallback, useRef } from 'react';
// import {
//   View,
//   Text,
//   StyleSheet,
//   FlatList,
//   TouchableOpacity,
//   Alert,
//   ActivityIndicator,
//   RefreshControl,
//   Platform,
//   Switch,
// } from 'react-native';
// import { useTheme } from '../theme/ThemeContext';
// import { supabase } from '../services/supabase';
// import { launchImageLibrary } from 'react-native-image-picker';
// import PhotoGridItem from '../components/PhotoGridItem';
// import ImageViewing from 'react-native-image-viewing';
// import Modal from 'react-native-modal';
// import Share from 'react-native-share';
// import BlobUtil from 'react-native-blob-util';

// const IMAGEKIT_PUBLIC_KEY = 'public_IAZdw7PGwJlYkHZC8/KN4/9TdRw='; // <-- YOUR KEY

// const GalleryScreen = ({ navigation }) => {
//   const { theme, toggleTheme } = useTheme();
//   const [images, setImages] = useState([]);
//   const [loading, setLoading] = useState(true);
//   const [uploading, setUploading] = useState(false);
//   const [progress, setProgress] = useState(0);
//   const [refreshing, setRefreshing] = useState(false);
//   const [isViewerVisible, setIsViewerVisible] = useState(false);
//   const [currentIndex, setCurrentIndex] = useState(0);
//   const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
//   const [selectedImage, setSelectedImage] = useState(null);
//   const [showOnlyMine, setShowOnlyMine] = useState(false);
//   const [currentUserId, setCurrentUserId] = useState(null);
//   const [fetchError, setFetchError] = useState(null);

//   const flatListRef = useRef();

//   // Debug log for every render
//   console.log('[GalleryScreen] Render', {
//     loading,
//     imagesCount: images.length,
//     showOnlyMine,
//     currentUserId,
//   });

//   const fetchImages = useCallback(async () => {
//     console.log('[GalleryScreen] --- Fetching images from Supabase... ---');
//     setLoading(true);
//     setFetchError(null);
//     let query = supabase
//       .from('images')
//       .select('id, image_url, user_id, favorite')
//       .order('created_at', { ascending: false });
//     if (showOnlyMine && currentUserId) {
//       query = query.eq('user_id', currentUserId);
//     }
//     const { data, error } = await query;
//     if (error) {
//       setFetchError(error.message);
//       Alert.alert('Error fetching images', error.message);
//       console.log('[GalleryScreen] Supabase fetch error:', error.message);
//       setImages([]);
//     } else {
//       setImages(data || []);
//       console.log(
//         '[GalleryScreen] Supabase fetch success. Images:',
//         data?.length,
//         data,
//       );
//     }
//     setLoading(false);
//     setRefreshing(false);
//   }, [showOnlyMine, currentUserId]);

//   useEffect(() => {
//     supabase.auth.getUser().then(({ data: { user } }) => {
//       setCurrentUserId(user?.id);
//       console.log('[GalleryScreen] Current user:', user?.id);
//     });
//   }, []);

//   useEffect(() => {
//     fetchImages();
//     const imagesChannel = supabase
//       .channel('public:images')
//       .on(
//         'postgres_changes',
//         { event: '*', schema: 'public', table: 'images' },
//         payload => {
//           console.log(
//             '[GalleryScreen] --- Supabase real-time event received ---',
//             payload.eventType,
//           );
//           fetchImages(); // Refetch all images on any change
//         },
//       )
//       .subscribe();

//     return () => {
//       supabase.removeChannel(imagesChannel);
//     };
//   }, [fetchImages]);

//   const fetchImageKitSignature = async () => {
//     console.log('[UPLOAD] 2. Requesting ImageKit signature from backend...');
//     try {
//       const response = await fetch(
//         'https://boyfriend-needs-backend.vercel.app/api/imagekit-auth',
//       );
//       if (!response.ok) throw new Error('Failed to get ImageKit signature');
//       const data = await response.json();
//       console.log('[UPLOAD] 3. Received ImageKit signature.', data);
//       return data;
//     } catch (err) {
//       console.error('[UPLOAD] 3. FAILED to get ImageKit signature:', err);
//       throw err;
//     }
//   };

//   const handleImagePickAndUpload = () => {
//     launchImageLibrary(
//       { mediaType: 'photo', selectionLimit: 0 },
//       async response => {
//         if (response.didCancel) {
//           console.log('[UPLOAD] User cancelled image picker.');
//           return;
//         }
//         if (response.errorCode) {
//           console.error('[UPLOAD] ImagePicker Error:', response.errorMessage);
//           return;
//         }

//         const assets = response.assets;
//         if (!assets || assets.length === 0) {
//           console.log('[UPLOAD] No assets selected.');
//           return;
//         }

//         console.log(`[UPLOAD] 1. User selected ${assets.length} photo(s).`);
//         setUploading(true);
//         let successCount = 0;

//         for (let i = 0; i < assets.length; i++) {
//           const asset = assets[i];
//           setProgress(0); // Reset progress for each file

//           try {
//             const signatureData = await fetchImageKitSignature();

//             const uploadData = [
//               {
//                 name: 'file',
//                 filename: asset.fileName,
//                 data: BlobUtil.wrap(asset.uri.replace('file://', '')),
//               },
//               {
//                 name: 'publicKey',
//                 data: IMAGEKIT_PUBLIC_KEY, // <-- FIXED KEY
//               },
//               { name: 'signature', data: signatureData.signature },
//               { name: 'expire', data: String(signatureData.expire) },
//               { name: 'token', data: signatureData.token },
//               { name: 'fileName', data: asset.fileName },
//             ];

//             console.log(`[UPLOAD] 4. Starting upload for image ${i + 1}...`);
//             const task = BlobUtil.fetch(
//               'POST',
//               'https://upload.imagekit.io/api/v1/files/upload',
//               { 'Content-Type': 'multipart/form-data' },
//               uploadData,
//             );

//             task.uploadProgress((written, total) => {
//               const percentage = Math.round((written / total) * 100);
//               console.log(
//                 `[UPLOAD] Progress for image ${i + 1}: ${percentage}%`,
//               );
//               setProgress(percentage);
//             });

//             const uploadResult = await task;
//             const resultJson = uploadResult.json();

//             if (uploadResult.info().status >= 300) {
//               console.error(
//                 '[UPLOAD] 5. FAILED to upload to ImageKit:',
//                 resultJson,
//               );
//               throw new Error(resultJson.message || 'ImageKit upload failed');
//             }
//             console.log(
//               '[UPLOAD] 5. SUCCESS uploading to ImageKit. URL:',
//               resultJson.url,
//             );

//             const {
//               data: { user },
//             } = await supabase.auth.getUser();
//             if (user) {
//               console.log('[UPLOAD] 6. Saving URL to Supabase...');
//               const { error: supabaseError } = await supabase
//                 .from('images')
//                 .insert({
//                   user_id: user.id,
//                   image_url: resultJson.url,
//                   favorite: false,
//                 });
//               if (supabaseError) {
//                 console.error(
//                   '[UPLOAD] 7. FAILED to save to Supabase:',
//                   supabaseError,
//                 );
//                 throw supabaseError;
//               }
//               console.log('[UPLOAD] 7. SUCCESS saving to Supabase.');
//               successCount++;
//             }
//           } catch (e) {
//             Alert.alert('Upload Error', e.message);
//             break; // Stop uploading if one fails
//           }
//         }
//         setUploading(false);
//         if (successCount > 0) {
//           Alert.alert('Success', `${successCount} photo(s) uploaded!`);
//         }
//       },
//     );
//   };

//   const handleSignOut = async () => {
//     await supabase.auth.signOut();
//     navigation.replace('ProfileSelector');
//   };

//   const onRefresh = () => {
//     setRefreshing(true);
//     fetchImages();
//   };

//   const openImage = index => {
//     console.log('[GalleryScreen] openImage index:', index);
//     setCurrentIndex(index);
//     setIsViewerVisible(true);
//   };

//   const openDeleteModal = image => {
//     setSelectedImage(image);
//     setIsDeleteModalVisible(true);
//   };

//   const handleDelete = async () => {
//     if (!selectedImage) return;
//     try {
//       const { error } = await supabase
//         .from('images')
//         .delete()
//         .eq('id', selectedImage.id);
//       if (error) {
//         Alert.alert('Delete Error', error.message);
//       } else {
//         setIsDeleteModalVisible(false);
//         setSelectedImage(null);
//       }
//     } catch (e) {
//       Alert.alert('Delete Error', e.message);
//     }
//   };

//   const handleShare = async () => {
//     try {
//       const image = images[currentIndex];
//       if (!image) return;
//       await Share.open({ url: image.image_url });
//     } catch (e) {
//       Alert.alert('Share Error', e.message);
//     }
//   };

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
//       Alert.alert('Saved!', 'Image saved to your device.');
//     } catch (e) {
//       Alert.alert('Save Error', e.message);
//     }
//   };

//   const handleToggleFavorite = async image => {
//     try {
//       await supabase
//         .from('images')
//         .update({ favorite: !image.favorite })
//         .eq('id', image.id);
//     } catch (e) {
//       Alert.alert('Favorite Error', e.message);
//     }
//   };

//   // Scroll to top FAB
//   const scrollToTop = () => {
//     if (flatListRef.current) {
//       flatListRef.current.scrollToOffset({ offset: 0, animated: true });
//     }
//   };

//   // UI rendering
//   if (loading) {
//     return (
//       <View style={styles.loader}>
//         <ActivityIndicator size="large" color={theme.colors.primary} />
//         <Text style={{ color: theme.colors.text, marginTop: 10 }}>
//           Loading gallery...
//         </Text>
//       </View>
//     );
//   }

//   if (fetchError) {
//     return (
//       <View style={styles.loader}>
//         <Text style={{ color: 'red', marginBottom: 10 }}>
//           Error: {fetchError}
//         </Text>
//         <TouchableOpacity onPress={fetchImages} style={styles.fab}>
//           <Text style={styles.fabIcon}>⟳</Text>
//         </TouchableOpacity>
//       </View>
//     );
//   }

//   return (
//     <View style={styles.container}>
//       {/* Header */}
//       <View style={styles.header}>
//         <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
//           Gallery
//         </Text>
//         <TouchableOpacity onPress={handleSignOut}>
//           <Text style={styles.signOutText}>Sign Out</Text>
//         </TouchableOpacity>
//       </View>

//       {/* Filter Bar */}
//       <View style={styles.filterBar}>
//         <Text style={{ color: theme.colors.text, marginRight: 10 }}>
//           Show only my uploads
//         </Text>
//         <Switch
//           value={showOnlyMine}
//           onValueChange={setShowOnlyMine}
//           thumbColor={showOnlyMine ? theme.colors.primary : '#ccc'}
//         />
//         <View style={{ marginLeft: 20 }}>
//           <Text style={{ color: theme.colors.text, marginRight: 10 }}>
//             Dark Mode
//           </Text>
//         </View>
//         <Switch
//           value={theme.mode === 'dark'}
//           onValueChange={toggleTheme}
//           thumbColor={theme.mode === 'dark' ? theme.colors.primary : '#ccc'}
//         />
//       </View>

//       {/* No images fallback */}
//       {images.length === 0 ? (
//         <View
//           style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
//         >
//           <Text
//             style={{ color: theme.colors.text, fontSize: 18, marginBottom: 20 }}
//           >
//             No images yet. Tap + to upload!
//           </Text>
//         </View>
//       ) : (
//         <FlatList
//           numColumns={2}
//           ref={flatListRef}
//           data={images}
//           keyExtractor={item => item.id.toString()}
//           contentContainerStyle={styles.grid}
//           refreshControl={
//             <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
//           }
//           renderItem={({ item, index }) => (
//             <PhotoGridItem
//               image={item}
//               index={index}
//               onPress={() => openImage(index)}
//               onDelete={() => openDeleteModal(item)}
//               onToggleFavorite={() => handleToggleFavorite(item)}
//               isMine={item.user_id === currentUserId}
//             />
//           )}
//         />
//       )}

//       {/* Upload FAB */}
//       <TouchableOpacity
//         style={[styles.fab, { backgroundColor: theme.colors.primary }]}
//         onPress={handleImagePickAndUpload}
//       >
//         <Text style={styles.fabIcon}>+</Text>
//       </TouchableOpacity>

//       {/* Scroll to Top FAB (if many images) */}
//       {images.length > 10 && (
//         <TouchableOpacity
//           style={[styles.fab, { bottom: 100, backgroundColor: '#444' }]}
//           onPress={scrollToTop}
//         >
//           <Text style={styles.fabIcon}>↑</Text>
//         </TouchableOpacity>
//       )}

//       {/* Upload Progress */}
//       {uploading && (
//         <View style={styles.uploadStatus}>
//           <ActivityIndicator color="white" />
//           <Text style={styles.uploadText}>Uploading... {progress}%</Text>
//         </View>
//       )}

//       {/* Image Viewer */}
//       <ImageViewing
//         images={images.map(img => ({ uri: img.image_url }))}
//         imageIndex={currentIndex}
//         visible={isViewerVisible}
//         onRequestClose={() => setIsViewerVisible(false)}
//         FooterComponent={() => (
//           <View style={styles.viewerFooter}>
//             <TouchableOpacity style={styles.viewerButton} onPress={handleShare}>
//               <Text style={styles.viewerButtonText}>Share</Text>
//             </TouchableOpacity>
//             <TouchableOpacity style={styles.viewerButton} onPress={handleSave}>
//               <Text style={styles.viewerButtonText}>Save</Text>
//             </TouchableOpacity>
//             <TouchableOpacity
//               style={styles.viewerButton}
//               onPress={() => openDeleteModal(images[currentIndex])}
//             >
//               <Text style={styles.viewerButtonText}>Delete</Text>
//             </TouchableOpacity>
//           </View>
//         )}
//       />

//       {/* Delete Modal */}
//       <Modal isVisible={isDeleteModalVisible}>
//         <View style={styles.modalContent}>
//           <Text style={{ color: 'white', fontSize: 18, marginBottom: 20 }}>
//             Are you sure you want to delete this photo?
//           </Text>
//           <View style={{ flexDirection: 'row' }}>
//             <TouchableOpacity style={styles.modalButton} onPress={handleDelete}>
//               <Text style={{ color: 'white' }}>Delete</Text>
//             </TouchableOpacity>
//             <TouchableOpacity
//               style={styles.modalButton}
//               onPress={() => setIsDeleteModalVisible(false)}
//             >
//               <Text style={{ color: 'white' }}>Cancel</Text>
//             </TouchableOpacity>
//           </View>
//         </View>
//       </Modal>
//     </View>
//   );
// };

// const styles = StyleSheet.create({
//   container: { flex: 1, backgroundColor: '#121212' },
//   loader: {
//     flex: 1,
//     justifyContent: 'center',
//     alignItems: 'center',
//     backgroundColor: '#121212',
//   },
//   header: {
//     paddingTop: 50,
//     paddingBottom: 15,
//     paddingHorizontal: 20,
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     alignItems: 'center',
//     backgroundColor: '#1c1c1c',
//   },
//   headerTitle: { fontSize: 24, fontWeight: 'bold' },
//   signOutText: { color: '#FF6347', fontSize: 16 },
//   filterBar: {
//     flexDirection: 'row',
//     justifyContent: 'center',
//     alignItems: 'center',
//     marginVertical: 10,
//   },
//   filterButton: {
//     padding: 8,
//     borderRadius: 8,
//     borderWidth: 1,
//     borderColor: '#4FC3F7',
//     marginHorizontal: 5,
//   },
//   grid: { padding: 5 },
//   fab: {
//     position: 'absolute',
//     right: 30,
//     bottom: 30,
//     width: 60,
//     height: 60,
//     borderRadius: 30,
//     justifyContent: 'center',
//     alignItems: 'center',
//     elevation: 8,
//   },
//   fabIcon: { fontSize: 30, color: 'white' },
//   uploadStatus: {
//     position: 'absolute',
//     bottom: 30,
//     alignSelf: 'center',
//     backgroundColor: 'rgba(0,0,0,0.7)',
//     paddingVertical: 10,
//     paddingHorizontal: 20,
//     borderRadius: 20,
//     flexDirection: 'row',
//     alignItems: 'center',
//   },
//   uploadText: { marginLeft: 10, fontSize: 16, color: 'white' },
//   modalContent: {
//     backgroundColor: '#222',
//     padding: 24,
//     borderRadius: 12,
//     alignItems: 'center',
//   },
//   modalButton: {
//     backgroundColor: '#444',
//     padding: 12,
//     borderRadius: 8,
//     marginHorizontal: 10,
//     minWidth: 80,
//     alignItems: 'center',
//   },
//   favoriteRow: {
//     position: 'absolute',
//     bottom: 10,
//     right: 10,
//     backgroundColor: 'rgba(0,0,0,0.5)',
//     borderRadius: 15,
//     padding: 5,
//   },
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
//   viewerButtonText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
// });

// export default GalleryScreen;
