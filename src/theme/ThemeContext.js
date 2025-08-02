/**
 * src/theme/ThemeContext.js
 * This is the heart of our theming system. It uses React's Context API
 * to provide the selected theme to all components in the app without
 * having to pass props down manually.
 */
import React, { createContext, useState, useContext, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS } from './colors';

// Create a Context object.
const ThemeContext = createContext();

// Create a provider component.
export const ThemeProvider = ({ children }) => {
  const [themeName, setThemeName] = useState('blue'); // Default theme

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
      }
    };
    loadTheme();
  }, []);

  // Function to change and save the theme
  const setCurrentTheme = async name => {
    try {
      await AsyncStorage.setItem('appTheme', name);
      setThemeName(name);
    } catch (error) {
      console.error('Failed to save theme.', error);
    }
  };

  // The actual theme object that components will use
  const theme = {
    name: themeName,
    colors: themeName === 'pink' ? COLORS.pink : COLORS.blue,
    background: COLORS.black,
    text: COLORS.white,
    gray: COLORS.gray,
  };

  return (
    <ThemeContext.Provider value={{ theme, setCurrentTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

// Custom hook to easily use the theme in any component
export const useTheme = () => useContext(ThemeContext);
