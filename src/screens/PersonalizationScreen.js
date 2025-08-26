import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const PersonalizationScreen = () => (
  <View style={styles.container}>
    <Text style={styles.title}>
      Idunna next update alli madtini Bhoo, I am sorry Kano.
    </Text>
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

export default PersonalizationScreen;
