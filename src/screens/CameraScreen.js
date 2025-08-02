import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import Icon from 'react-native-vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';

const CameraScreen = () => {
  const { theme } = useTheme();
  return (
    <SafeAreaView
      style={[
        styles.container,
        { backgroundColor: theme.colors.primary + '20' },
      ]}
    >
      <Icon name="camera-outline" size={80} color={theme.colors.primary} />
      <Text style={styles.text}>Camera feature coming soon!</Text>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  text: { fontSize: 18, color: '#222', marginTop: 20 },
});

export default CameraScreen;
