import React from 'react';
import {
  Image,
  StyleSheet,
  Dimensions,
  View,
  TouchableOpacity,
} from 'react-native';

const { width } = Dimensions.get('window');
const itemSize = (width - 30) / 2; // 2 columns, 10px margin

const PhotoGridItem = ({ image, index, onPress }) => {
  console.log('[PhotoGridItem] Rendering:', image?.image_url);
  if (!image || !image.image_url) return null;
  return (
    <TouchableOpacity onPress={onPress} style={styles.container}>
      <Image source={{ uri: image.image_url }} style={styles.image} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    width: itemSize,
    height: itemSize,
    margin: 5,
    borderRadius: 8,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
    backgroundColor: '#282828',
  },
});

export default PhotoGridItem;
