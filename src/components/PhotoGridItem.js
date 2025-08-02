import React from 'react';
import { Image, StyleSheet, Dimensions, TouchableOpacity } from 'react-native';

const { width } = Dimensions.get('window');
const itemSize = (width - 40) / 2;

const PhotoGridItem = ({ image, onPress }) => {
  if (!image || !image.image_url) return null;
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.container}
      activeOpacity={0.85}
    >
      <Image source={{ uri: image.image_url }} style={styles.image} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    width: itemSize,
    height: itemSize,
    margin: 5,
    borderRadius: 12,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
    backgroundColor: '#eee',
  },
});

export default PhotoGridItem;
