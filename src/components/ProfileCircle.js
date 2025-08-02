/**
 * src/components/ProfileCircle.js
 * A reusable component for the profile selection circles.
 */
import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { COLORS } from '../theme/colors';

const ProfileCircle = ({ name, color, onPress }) => {
  return (
    <TouchableOpacity
      style={[styles.circle, { backgroundColor: color }]}
      onPress={onPress}
    >
      <Text style={styles.text}>{name}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  circle: {
    width: 140,
    height: 140,
    borderRadius: 70, // Makes it a perfect circle
    justifyContent: 'center',
    alignItems: 'center',
    margin: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 8,
  },
  text: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default ProfileCircle;
