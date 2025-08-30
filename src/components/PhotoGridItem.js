import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Image,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  Animated,
  Text,
  ActivityIndicator,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import LinearGradient from 'react-native-linear-gradient';
import { useTheme } from '../theme/ThemeContext';
import { COLORS } from '../theme/colors';

const { width } = Dimensions.get('window');
const GRID_GAP = 12;
const CONTAINER_PADDING = 16;
const itemSize = (width - CONTAINER_PADDING * 2 - GRID_GAP) / 2;

const PhotoGridItem = ({
  image,
  onPress,
  onLongPress,
  selected = false,
  showSelect = false,
  profile = 'me',
  index = 0,
}) => {
  const { theme } = useTheme();
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);

  // Animations
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const selectAnim = useRef(new Animated.Value(0)).current;
  const heartAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current; // Keep as number for interpolation
  const shimmerAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Profile-based colors
  const profileColors = profile === 'me' ? COLORS.blue : COLORS.pink;
  const gradientColors = [profileColors.primary, profileColors.secondary];

  // Entrance animation
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        delay: index * 50,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        from: 0.8,
        delay: index * 50,
        useNativeDriver: true,
      }),
    ]).start();
  }, [index, fadeAnim, scaleAnim]);

  // Selection animation
  useEffect(() => {
    Animated.spring(selectAnim, {
      toValue: selected ? 1 : 0,
      friction: 8,
      tension: 40,
      useNativeDriver: true,
    }).start();
  }, [selected, selectAnim]);

  // Favorite heart animation
  useEffect(() => {
    if (image?.favorite) {
      const HOLD_MS = 900; // adjust how long the heart stays visible
      heartAnim.stopAnimation();
      heartAnim.setValue(0.8); // start slightly small so the pop is visible

      Animated.sequence([
        Animated.spring(heartAnim, {
          toValue: 1.2,
          friction: 3,
          useNativeDriver: true,
        }),
        Animated.spring(heartAnim, {
          toValue: 1,
          friction: 3,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.timing(heartAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [image?.favorite, heartAnim]);

  // Shimmer loading effect
  useEffect(() => {
    if (imageLoading) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(shimmerAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(shimmerAnim, {
            toValue: 0,
            duration: 1000,
            useNativeDriver: true,
          }),
        ]),
      ).start();
    }
  }, [imageLoading, shimmerAnim]);

  // Pulse animation for video play button
  useEffect(() => {
    if (image?.type === 'video') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.1,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ]),
      ).start();
    }
  }, [image?.type, pulseAnim]);

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.95,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 3,
      useNativeDriver: true,
    }).start();
  };

  const handlePress = () => {
    // Wiggle animation (fixed rotation)
    Animated.sequence([
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 50,
        useNativeDriver: true,
      }),
      Animated.timing(rotateAnim, {
        toValue: -1,
        duration: 50,
        useNativeDriver: true,
      }),
      Animated.timing(rotateAnim, {
        toValue: 0,
        duration: 50,
        useNativeDriver: true,
      }),
    ]).start();

    console.log('[PhotoGridItem] onPress id:', image?.id);
    onPress?.();
  };

  const handleLongPress = () => {
    console.log('[PhotoGridItem] onLongPress id:', image?.id);
    // Haptic feedback simulation with animation
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 1.05,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();
    onLongPress?.();
  };

  if (!image || !image.image_url) return null;

  const isVideo = image.type === 'video';
  const duration = image.duration || image.metadata?.duration;

  // Fixed rotation interpolation - always returns a string
  const rotateInterpolation = rotateAnim.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: ['-2deg', '0deg', '2deg'], // Always string values with deg
  });

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: fadeAnim,
          transform: [
            { scale: scaleAnim },
            { rotate: rotateInterpolation }, // Use interpolated string value
          ],
        },
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onLongPress={handleLongPress}
        delayLongPress={250}
        style={styles.touchable}
      >
        {/* Main Container with shadow */}
        <View
          style={[styles.imageContainer, selected && styles.selectedContainer]}
        >
          {/* Main Image */}
          <Image
            source={{ uri: image.image_url }}
            style={styles.image}
            resizeMode="cover"
            onLoadStart={() => setImageLoading(true)}
            onLoadEnd={() => setImageLoading(false)}
            onError={e => {
              console.log(
                '[PhotoGridItem] image error id:',
                image.id,
                e.nativeEvent,
              );
              setImageError(true);
              setImageLoading(false);
            }}
          />

          {/* Loading shimmer */}
          {imageLoading && (
            <View style={styles.loadingContainer}>
              <Animated.View
                style={[
                  styles.shimmer,
                  {
                    opacity: shimmerAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.3, 0.7],
                    }),
                  },
                ]}
              >
                <LinearGradient
                  colors={['#f0f0f0', '#e0e0e0', '#f0f0f0']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={StyleSheet.absoluteFillObject}
                />
              </Animated.View>
              <ActivityIndicator color={profileColors.primary} />
            </View>
          )}

          {/* Error state */}
          {imageError && (
            <View style={styles.errorContainer}>
              <Icon name="image-outline" size={32} color="#999" />
              <Text style={styles.errorText}>Failed to load</Text>
            </View>
          )}

          {/* Gradient overlay for better text visibility */}
          <LinearGradient
            colors={['transparent', 'transparent', 'rgba(0,0,0,0.6)']}
            style={styles.gradientOverlay}
            pointerEvents="none"
          />

          {/* Video indicator with blur effect simulation */}
          {isVideo && (
            <View style={styles.videoIndicator}>
              <Animated.View
                style={[
                  styles.playButtonContainer,
                  { transform: [{ scale: pulseAnim }] },
                ]}
              >
                <LinearGradient
                  colors={['rgba(0,0,0,0.7)', 'rgba(0,0,0,0.5)']}
                  style={styles.playButton}
                >
                  <Icon
                    name="play"
                    size={24}
                    color="#fff"
                    style={styles.playIcon}
                  />
                </LinearGradient>
              </Animated.View>
              {duration && (
                <View style={styles.durationBadge}>
                  <Text style={styles.durationText}>
                    {formatDuration(duration)}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Top gradient for badges */}
          <LinearGradient
            colors={['rgba(0,0,0,0.4)', 'transparent']}
            style={styles.topGradient}
            pointerEvents="none"
          />

          {/* Selection indicator */}
          {showSelect && (
            <Animated.View
              style={[
                styles.selectContainer,
                {
                  transform: [
                    {
                      scale: selectAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [1, 1.2],
                      }),
                    },
                  ],
                },
              ]}
            >
              <LinearGradient
                colors={
                  selected
                    ? gradientColors
                    : ['rgba(255,255,255,0.9)', 'rgba(255,255,255,0.7)']
                }
                style={styles.selectGradient}
              >
                <Icon
                  name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                  size={20}
                  color={selected ? '#fff' : '#333'}
                />
              </LinearGradient>
            </Animated.View>
          )}

          {/* Favorite heart */}
          {image.favorite && (
            <Animated.View
              style={[
                styles.favoriteContainer,
                {
                  transform: [
                    {
                      scale: heartAnim,
                    },
                  ],
                  opacity: heartAnim,
                },
              ]}
              pointerEvents="none"
            >
              <LinearGradient
                colors={
                  profile === 'me'
                    ? ['#4FC3F7', '#29B6F6']
                    : ['#FF6B9D', '#FE8C00']
                }
                style={styles.heartGradient}
              >
                <Icon name="heart" size={16} color="#fff" />
              </LinearGradient>
            </Animated.View>
          )}

          {/* Metadata badges */}
          <View style={styles.metadataContainer}>
            {image.private && (
              <LinearGradient
                colors={['rgba(0,0,0,0.6)', 'rgba(0,0,0,0.4)']}
                style={styles.badge}
              >
                <Icon name="lock-closed" size={12} color="#fff" />
              </LinearGradient>
            )}
            {image.shared && (
              <LinearGradient
                colors={['rgba(0,0,0,0.6)', 'rgba(0,0,0,0.4)']}
                style={styles.badge}
              >
                <Icon name="share-social" size={12} color="#fff" />
              </LinearGradient>
            )}
          </View>

          {/* Date overlay */}
          {image.created_at && (
            <View style={styles.dateContainer}>
              <LinearGradient
                colors={['rgba(0,0,0,0.3)', 'rgba(0,0,0,0.2)']}
                style={styles.dateBadge}
              >
                <Text style={styles.dateText}>
                  {formatDate(image.created_at)}
                </Text>
              </LinearGradient>
            </View>
          )}

          {/* Selected overlay */}
          {selected && (
            <Animated.View
              style={[
                styles.selectedOverlay,
                {
                  opacity: selectAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 0.15],
                  }),
                },
              ]}
              pointerEvents="none"
            >
              <LinearGradient
                colors={[...gradientColors].map(c => c + '44')}
                style={StyleSheet.absoluteFillObject}
              />
            </Animated.View>
          )}

          {/* Border glow for selected state */}
          {selected && (
            <Animated.View
              style={[
                styles.borderGlow,
                {
                  opacity: selectAnim,
                },
              ]}
              pointerEvents="none"
            >
              <LinearGradient
                colors={gradientColors}
                style={styles.borderGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              />
            </Animated.View>
          )}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

// Helper functions
const formatDuration = seconds => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const formatDate = dateString => {
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
};

const styles = StyleSheet.create({
  container: {
    width: itemSize,
    height: itemSize,
    margin: GRID_GAP / 2,
  },
  touchable: {
    width: '100%',
    height: '100%',
  },
  imageContainer: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#f8f9fa',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  selectedContainer: {
    shadowColor: '#667EEA',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#f8f9fa',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shimmer: {
    ...StyleSheet.absoluteFillObject,
  },
  errorContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#f1f3f5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
  },
  gradientOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '40%',
  },
  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 50,
  },
  videoIndicator: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -30 }, { translateY: -30 }],
  },
  playButtonContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  playButton: {
    width: 60,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playIcon: {
    marginLeft: 4,
  },
  durationBadge: {
    position: 'absolute',
    bottom: -25,
    left: '50%',
    transform: [{ translateX: -25 }],
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  durationText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  selectContainer: {
    position: 'absolute',
    top: 8,
    left: 8,
  },
  selectGradient: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.22,
    shadowRadius: 2.22,
    elevation: 3,
  },
  favoriteContainer: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  heartGradient: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FF6B9D',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  metadataContainer: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    gap: 4,
  },
  badge: {
    borderRadius: 12,
    padding: 4,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.18,
    shadowRadius: 1.0,
    elevation: 1,
  },
  dateContainer: {
    position: 'absolute',
    bottom: 8,
    right: 8,
  },
  dateBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  dateText: {
    color: '',
    fontSize: 10,
    fontWeight: '500',
  },
  selectedOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  borderGlow: {
    position: 'absolute',
    top: -2,
    left: -2,
    right: -2,
    bottom: -2,
    borderRadius: 18,
  },
  borderGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'transparent',
  },
});

export default PhotoGridItem;

// import React, { useState } from 'react';
// import {
//   View,
//   Image,
//   StyleSheet,
//   Dimensions,
//   TouchableOpacity,
// } from 'react-native';
// import Icon from 'react-native-vector-icons/Ionicons';
// import { useTheme } from '../theme/ThemeContext';

// const { width } = Dimensions.get('window');
// const itemSize = (width - 48) / 2; // balanced with your container padding/margins

// const PhotoGridItem = ({
//   image,
//   onPress,
//   onLongPress,
//   selected = false,
//   showSelect = false,
// }) => {
//   const { theme } = useTheme();
//   if (!image || !image.image_url) return null;

//   return (
//     <TouchableOpacity
//       activeOpacity={0.85}
//       onPress={() => {
//         console.log('[PhotoGridItem] onPress id:', image.id);
//         onPress?.();
//       }}
//       onLongPress={() => {
//         console.log('[PhotoGridItem] onLongPress id:', image.id);
//         onLongPress?.();
//       }}
//       delayLongPress={250}
//       style={[
//         styles.container,
//         selected && { borderColor: theme.colors.primary, borderWidth: 2 },
//       ]}
//     >
//       <Image
//         source={{ uri: image.image_url }}
//         style={styles.image}
//         resizeMode="cover"
//         onError={e =>
//           console.log(
//             '[PhotoGridItem] image error id:',
//             image.id,
//             e.nativeEvent,
//           )
//         }
//       />

//       {/* Video badge */}
//       {image.type === 'video' && (
//         <View style={styles.centerBadge}>
//           <View style={styles.badgeBg}>
//             <Icon name="play" size={22} color="#fff" />
//           </View>
//         </View>
//       )}

//       {/* Favorite heart */}
//       {image.favorite ? (
//         <View style={styles.topRight}>
//           <View style={[styles.pill, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
//             <Icon name="heart" size={16} color="#FF80AB" />
//           </View>
//         </View>
//       ) : null}

//       {/* Selection checkbox */}
//       {showSelect && (
//         <View style={styles.topLeft}>
//           <View style={[styles.pill, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
//             <Icon
//               name={selected ? 'checkmark-circle' : 'ellipse-outline'}
//               size={18}
//               color={selected ? '#22c55e' : '#fff'}
//             />
//           </View>
//         </View>
//       )}
//     </TouchableOpacity>
//   );
// };

// const styles = StyleSheet.create({
//   container: {
//     width: itemSize,
//     height: itemSize,
//     margin: 6,
//     borderRadius: 14,
//     overflow: 'hidden',
//     backgroundColor: '#f1f5f9',
//   },
//   image: {
//     width: '100%',
//     height: '100%',
//   },
//   centerBadge: {
//     position: 'absolute',
//     top: '42%',
//     left: 0,
//     right: 0,
//     alignItems: 'center',
//   },
//   badgeBg: {
//     backgroundColor: 'rgba(0,0,0,0.55)',
//     width: 40,
//     height: 40,
//     borderRadius: 20,
//     alignItems: 'center',
//     justifyContent: 'center',
//   },
//   topRight: {
//     position: 'absolute',
//     top: 6,
//     right: 6,
//   },
//   topLeft: {
//     position: 'absolute',
//     top: 6,
//     left: 6,
//   },
//   pill: {
//     borderRadius: 12,
//     paddingHorizontal: 6,
//     paddingVertical: 4,
//   },
// });

// export default PhotoGridItem;
