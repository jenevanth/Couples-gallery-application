import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
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

const FavoritesScreen = ({ navigation }) => {
  const { theme } = useTheme();
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isViewerVisible, setIsViewerVisible] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [errorModal, setErrorModal] = useState({ visible: false, message: '' });
  const [successModal, setSuccessModal] = useState({
    visible: false,
    message: '',
  });

  // Debug log for every render
  console.log('[FavoritesScreen] Render', {
    loading,
    imagesCount: images.length,
  });

  // Fetch favorites from Supabase
  const fetchFavorites = useCallback(async () => {
    console.log(
      '[FavoritesScreen] --- Fetching favorites from Supabase... ---',
    );
    setLoading(true);
    const { data, error } = await supabase
      .from('images')
      .select('*')
      .eq('favorite', true)
      .order('created_at', { ascending: false });
    if (error) {
      setErrorModal({ visible: true, message: error.message });
      setImages([]);
    } else {
      setImages(data || []);
      console.log(
        '[FavoritesScreen] Supabase fetch success. Images:',
        data?.length,
        data,
      );
    }
    setLoading(false);
  }, []);

  // Real-time updates
  useEffect(() => {
    fetchFavorites();
    const imagesChannel = supabase
      .channel('public:images')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'images' },
        payload => {
          console.log(
            '[FavoritesScreen] --- Supabase real-time event received ---',
            payload.eventType,
          );
          fetchFavorites();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(imagesChannel);
    };
  }, [fetchFavorites]);

  // Open image viewer
  const openImage = index => {
    setCurrentIndex(index);
    setIsViewerVisible(true);
    console.log(
      '[FavoritesScreen] Opened viewer for image:',
      images[index]?.id,
      'at index',
      index,
    );
  };

  // Open delete modal
  const openDeleteModal = image => {
    setSelectedImage(image);
    setIsDeleteModalVisible(true);
    console.log('[FavoritesScreen] Opened delete modal for image:', image.id);
  };

  // Delete image
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
        fetchFavorites();
        console.log('[FavoritesScreen] Deleted image:', selectedImage.id);
      }
    } catch (e) {
      setErrorModal({ visible: true, message: e.message });
    }
  };

  // Share image
  const handleShare = async () => {
    try {
      const image = images[currentIndex];
      if (!image) return;
      await Share.open({ url: image.image_url });
      console.log('[FavoritesScreen] Shared image:', image.image_url);
    } catch (e) {
      setErrorModal({ visible: true, message: e.message });
    }
  };

  // Save image to device
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
      console.log('[FavoritesScreen] Saved image to device:', downloadDest);
    } catch (e) {
      setErrorModal({ visible: true, message: e.message });
    }
  };

  // Toggle favorite (unfavorite)
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
        '[FavoritesScreen] Toggled favorite for image:',
        image.id,
        'Now:',
        updated,
      );
    } catch (e) {
      setErrorModal({ visible: true, message: e.message });
    }
  };

  // Render each image in grid
  const renderItem = ({ item, index }) => (
    <PhotoGridItem image={item} onPress={() => openImage(index)} />
  );

  return (
    <SafeAreaView
      style={[
        styles.container,
        { backgroundColor: theme.colors.primary + '20' },
      ]}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.colors.primary }]}>
          Favorites
        </Text>
      </View>
      {loading ? (
        <ActivityIndicator size="large" color={theme.colors.primary} />
      ) : images.length === 0 ? (
        <View style={styles.emptyState}>
          <Icon name="heart-outline" size={60} color="#FF80AB" />
          <Text style={{ color: '#888', marginTop: 10, fontSize: 16 }}>
            No favorites yet!
          </Text>
        </View>
      ) : (
        <FlatList
          data={images}
          numColumns={2}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={styles.grid}
          renderItem={renderItem}
        />
      )}

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
  header: {
    alignItems: 'center',
    marginBottom: 16,
    paddingTop: 8,
  },
  title: { fontSize: 22, fontWeight: 'bold' },
  grid: { paddingBottom: 20 },
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
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 60,
  },
});

export default FavoritesScreen;
