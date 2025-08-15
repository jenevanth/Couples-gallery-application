import React, { createContext, useState, useContext, useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS } from './colors';

// Provide a default value for the context
const ThemeContext = createContext(null);

export const ThemeProvider = ({ children }) => {
  const [themeName, setThemeName] = useState('blue'); // Default theme
  const [loading, setLoading] = useState(true); // Add a loading state

  // On app start, load the saved theme from storage
  useEffect(() => {
    const loadTheme = async () => {
      try {
        const savedTheme = await AsyncStorage.getItem('appTheme');
        if (savedTheme !== null) {
          setThemeName(savedTheme);
        }
      } catch (error) {
        console.error('Failed to load theme.', error);
      } finally {
        // Once loading is finished, set loading to false
        setLoading(false);
      }
    };
    loadTheme();
  }, []);

  const setCurrentTheme = async name => {
    try {
      await AsyncStorage.setItem('appTheme', name);
      setThemeName(name);
    } catch (error) {
      console.error('Failed to save theme.', error);
    }
  };

  const theme = {
    name: themeName,
    colors: themeName === 'pink' ? COLORS.pink : COLORS.blue,
    background: COLORS.black,
    text: COLORS.white,
    gray: COLORS.gray,
  };

  // While the theme is loading from storage, show a loading indicator
  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // Once loaded, provide the theme to the rest of the app
  return (
    <ThemeContext.Provider value={{ theme, setCurrentTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

// Custom hook remains the same
export const useTheme = () => useContext(ThemeContext);
