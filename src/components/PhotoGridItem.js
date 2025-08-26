import React, { useState } from 'react';
import {
  View,
  Image,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../theme/ThemeContext';

const { width } = Dimensions.get('window');
const itemSize = (width - 48) / 2; // balanced with your container padding/margins

const PhotoGridItem = ({
  image,
  onPress,
  onLongPress,
  selected = false,
  showSelect = false,
}) => {
  const { theme } = useTheme();
  if (!image || !image.image_url) return null;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => {
        console.log('[PhotoGridItem] onPress id:', image.id);
        onPress?.();
      }}
      onLongPress={() => {
        console.log('[PhotoGridItem] onLongPress id:', image.id);
        onLongPress?.();
      }}
      delayLongPress={250}
      style={[
        styles.container,
        selected && { borderColor: theme.colors.primary, borderWidth: 2 },
      ]}
    >
      <Image
        source={{ uri: image.image_url }}
        style={styles.image}
        resizeMode="cover"
        onError={e =>
          console.log(
            '[PhotoGridItem] image error id:',
            image.id,
            e.nativeEvent,
          )
        }
      />

      {/* Video badge */}
      {image.type === 'video' && (
        <View style={styles.centerBadge}>
          <View style={styles.badgeBg}>
            <Icon name="play" size={22} color="#fff" />
          </View>
        </View>
      )}

      {/* Favorite heart */}
      {image.favorite ? (
        <View style={styles.topRight}>
          <View style={[styles.pill, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
            <Icon name="heart" size={16} color="#FF80AB" />
          </View>
        </View>
      ) : null}

      {/* Selection checkbox */}
      {showSelect && (
        <View style={styles.topLeft}>
          <View style={[styles.pill, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
            <Icon
              name={selected ? 'checkmark-circle' : 'ellipse-outline'}
              size={18}
              color={selected ? '#22c55e' : '#fff'}
            />
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    width: itemSize,
    height: itemSize,
    margin: 6,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#f1f5f9',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  centerBadge: {
    position: 'absolute',
    top: '42%',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  badgeBg: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topRight: {
    position: 'absolute',
    top: 6,
    right: 6,
  },
  topLeft: {
    position: 'absolute',
    top: 6,
    left: 6,
  },
  pill: {
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
});

export default PhotoGridItem;

// import React from 'react';
// import { Image, StyleSheet, Dimensions, TouchableOpacity } from 'react-native';

// const { width } = Dimensions.get('window');
// const itemSize = (width - 40) / 2;

// const PhotoGridItem = ({ image, onPress }) => {
//   if (!image || !image.image_url) return null;
//   return (
//     <TouchableOpacity
//       onPress={onPress}
//       style={styles.container}
//       activeOpacity={0.85}
//     >
//       <Image source={{ uri: image.image_url }} style={styles.image} />
//     </TouchableOpacity>
//   );
// };

// const styles = StyleSheet.create({
//   container: {
//     width: itemSize,
//     height: itemSize,
//     margin: 5,
//     borderRadius: 12,
//     overflow: 'hidden',
//   },
//   image: {
//     width: '100%',
//     height: '100%',
//     borderRadius: 12,
//     backgroundColor: '#eee',
//   },
// });

// export default PhotoGridItem;
