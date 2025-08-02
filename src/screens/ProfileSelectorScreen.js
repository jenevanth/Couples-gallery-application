/**
 * src/screens/ProfileSelectorScreen.js
 * The first screen the user sees. Allows them to pick their profile,
 * which sets the theme for the rest of the app.
 */
import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import ProfileCircle from '../components/ProfileCircle';
import { COLORS } from '../theme/colors';

const ProfileSelectorScreen = ({ navigation }) => {
  // useTheme hook gives us access to the theme and the function to change it
  const { setCurrentTheme } = useTheme();

  const handleProfileSelect = themeName => {
    setCurrentTheme(themeName); // Set the theme (pink or blue)
    navigation.replace('Auth'); // Go to the Auth screen
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>boyfriend_needs</Text>
      <View style={styles.circlesContainer}>
        <ProfileCircle
          name="Bugaa Boo"
          color={COLORS.blue.primary}
          onPress={() => handleProfileSelect('blue')}
        />
        <ProfileCircle
          name="Bhoo Booo"
          color={COLORS.pink.primary}
          onPress={() => handleProfileSelect('pink')}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.black,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.white,
    position: 'absolute',
    top: 100,
  },
  circlesContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
});

export default ProfileSelectorScreen;
