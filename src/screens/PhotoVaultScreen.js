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
  Image,
  Alert,
  Dimensions,
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
import { format, parseISO, isToday } from 'date-fns';

const VAULT_PASSWORD = 'LOVE'; // Change this to your 4-letter password
const IMAGEKIT_PUBLIC_KEY = 'public_IAZdw7PGwJlYkHZC8/KN4/9TdRw=';

const { width } = Dimensions.get('window');
const gridItemSize = (width - 48) / 2;

const PhotoVaultScreen = ({ navigation }) => {
  const { theme } = useTheme();
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isViewerVisible, setIsViewerVisible] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [fetchError, setFetchError] = useState(null);
  const [errorModal, setErrorModal] = useState({ visible: false, message: '' });
  const [successModal, setSuccessModal] = useState({
    visible: false,
    message: '',
  });
  const [password, setPassword] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [userId, setUserId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  // Fetch userId
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id || '');
      console.log('[Vault] userId:', user?.id);
    });
  }, []);

  // Fetch vault images from Supabase
  const fetchImages = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    const { data, error } = await supabase
      .from('images')
      .select('*')
      .eq('private', true)
      .order('created_at', { ascending: false });
    if (error) {
      setFetchError(error.message);
      setErrorModal({ visible: true, message: error.message });
      setImages([]);
      console.log('[Vault] Fetch error:', error);
    } else {
      setImages(data || []);
      console.log('[Vault] Loaded images:', data?.length);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (unlocked) fetchImages();
  }, [unlocked, fetchImages]);

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

  // Upload handler (ImageKit, always private)
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
        for (let i = 0; i < assets.length; i++) {
          const asset = assets[i];
          setProgress(0);
          try {
            // Upload to ImageKit
            const signatureData = await fetch(
              'https://boyfriend-needs-backend.vercel.app/api/imagekit-auth',
            ).then(res => res.json());
            console.log('[Vault] Got ImageKit signature:', signatureData);
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
            const uploadUrl = resultJson.url;
            console.log('[Vault] ImageKit upload success:', uploadUrl);

            // Save to Supabase (private: true)
            const { error: supabaseError } = await supabase
              .from('images')
              .insert({
                user_id: userId,
                image_url: uploadUrl,
                storage_type: 'imagekit',
                created_at: new Date().toISOString(),
                file_name: asset.fileName,
                favorite: false,
                private: true,
              });
            if (supabaseError) {
              setErrorModal({ visible: true, message: supabaseError.message });
              console.log('[Vault] Supabase insert error:', supabaseError);
              break;
            }
            successCount++;
          } catch (e) {
            setErrorModal({ visible: true, message: e.message });
            console.log('[Vault] Upload error:', e);
            break;
          }
        }
        setUploading(false);
        if (successCount > 0) {
          setSuccessModal({
            visible: true,
            message: `${successCount} photo(s) uploaded to vault!`,
          });
        }
        fetchImages();
      },
    );
  };

  // Move photo to gallery
  const moveToGallery = async image => {
    try {
      const { error } = await supabase
        .from('images')
        .update({ private: false })
        .eq('id', image.id);
      if (error) {
        setErrorModal({ visible: true, message: error.message });
        console.log('[Vault] Move to gallery error:', error);
      } else {
        setSuccessModal({ visible: true, message: 'Moved to Gallery!' });
        fetchImages();
      }
    } catch (e) {
      setErrorModal({ visible: true, message: e.message });
      console.log('[Vault] Move to gallery error:', e);
    }
  };

  // Delete photo
  const handleDelete = async () => {
    if (!selectedImage) return;
    try {
      const { error } = await supabase
        .from('images')
        .delete()
        .eq('id', selectedImage.id);
      if (error) {
        setErrorModal({ visible: true, message: error.message });
        console.log('[Vault] Delete error:', error);
      } else {
        setIsDeleteModalVisible(false);
        setSelectedImage(null);
        fetchImages();
      }
    } catch (e) {
      setErrorModal({ visible: true, message: e.message });
      console.log('[Vault] Delete error:', e);
    }
  };

  // Share photo
  const handleShare = async () => {
    try {
      const image = images[currentIndex];
      if (!image) return;
      await Share.open({ url: image.image_url });
      console.log('[Vault] Shared image:', image.image_url);
    } catch (e) {
      setErrorModal({ visible: true, message: e.message });
      console.log('[Vault] Share error:', e);
    }
  };

  // Save photo to device
  const handleSave = async () => {
    try {
      const image = images[currentIndex];
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
      console.log('[Vault] Saved image to device:', downloadDest);
    } catch (e) {
      setErrorModal({ visible: true, message: e.message });
      console.log('[Vault] Save error:', e);
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
      </View>
      <FlatList
        data={imagesArr}
        numColumns={2}
        keyExtractor={item => item.id.toString()}
        renderItem={({ item, index }) => (
          <PhotoGridItem
            image={item}
            onPress={() => {
              const idx = images.findIndex(img => img.id === item.id);
              setCurrentIndex(idx);
              setIsViewerVisible(true);
            }}
          />
        )}
        scrollEnabled={false}
      />
    </View>
  );

  // Vault stats
  const lastAdded =
    images.length > 0
      ? format(parseISO(images[0].created_at), 'MMMM d, yyyy')
      : null;

  // Password screen
  if (!unlocked) {
    return (
      <SafeAreaView style={styles.lockScreen}>
        <Icon name="lock-closed" size={60} color={theme.colors.primary} />
        <Text
          style={{
            fontSize: 22,
            color: theme.colors.primary,
            marginTop: 18,
            fontWeight: 'bold',
          }}
        >
          Enter Vault Password
        </Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor="#aaa"
          style={styles.passwordInput}
          secureTextEntry
          maxLength={8}
          autoCapitalize="characters"
        />
        <TouchableOpacity
          style={[styles.unlockBtn, { backgroundColor: theme.colors.primary }]}
          onPress={() => {
            if (password.toUpperCase() === VAULT_PASSWORD) {
              setUnlocked(true);
              setPassword('');
            } else {
              Alert.alert('Wrong Password', 'Try again!');
              setPassword('');
            }
          }}
        >
          <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>
            Unlock
          </Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.loader}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </SafeAreaView>
    );
  }

  // Group and filter images
  const groupedImages = groupImagesByDate(images);

  return (
    <SafeAreaView
      style={[
        styles.container,
        { backgroundColor: theme.colors.primary + '10' },
      ]}
    >
      <View style={styles.header}>
        <Icon name="lock-closed" size={28} color={theme.colors.primary} />
        <Text style={styles.headerTitle}>Photo Vault</Text>
        <View style={{ width: 28 }} />
      </View>
      {/* Vault stats */}
      <View style={styles.statsRow}>
        <Text style={{ color: theme.colors.primary, fontWeight: 'bold' }}>
          {images.length} photos
        </Text>
        {lastAdded && (
          <Text style={{ color: '#888' }}>Last added: {lastAdded}</Text>
        )}
      </View>
      {/* Upload button */}
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
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        {Object.keys(groupedImages).map(date =>
          renderSection(date, groupedImages[date]),
        )}
      </ScrollView>
      {/* Image Viewer */}
      <ImageViewing
        images={images.map(img => ({ uri: img.image_url }))}
        imageIndex={currentIndex}
        visible={isViewerVisible}
        onRequestClose={() => setIsViewerVisible(false)}
        FooterComponent={() => {
          const image = images[currentIndex];
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
                onPress={() => moveToGallery(image)}
              >
                <Icon name="images-outline" size={22} color="#4FC3F7" />
                <Text style={{ color: '#4FC3F7', marginLeft: 4, fontSize: 13 }}>
                  Move to Gallery
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.viewerButton}
                onPress={() => {
                  setSelectedImage(image);
                  setIsDeleteModalVisible(true);
                }}
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
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  lockScreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  passwordInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    fontSize: 22,
    letterSpacing: 8,
    marginTop: 18,
    marginBottom: 18,
    textAlign: 'center',
    width: 180,
    backgroundColor: '#fafafa',
    color: '#222',
  },
  unlockBtn: {
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    width: 140,
    marginTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#FF80AB',
    textAlign: 'center',
    flex: 1,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    marginHorizontal: 4,
  },
  section: { marginBottom: 24 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#222' },
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
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 44,
  },
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
});

export default PhotoVaultScreen;
