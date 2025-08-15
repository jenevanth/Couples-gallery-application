import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const PhotoVaultScreen = () => (
  <View style={styles.container}>
    <Text style={styles.title}>PhotoVaultScreen</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFF0F6',
  },
  title: { fontSize: 24, fontWeight: 'bold', color: '#FF80AB' },
});

export default PhotoVaultScreen;
