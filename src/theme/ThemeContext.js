import React, { createContext, useState, useContext, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS } from './colors';
const ThemeContext = createContext();
export const ThemeProvider = ({ children }) => {
  const [themeName, setThemeName] = useState('blue');
  useEffect(() => {
    const loadTheme = async () => {
      try {
        const savedTheme = await AsyncStorage.getItem('appTheme');
        if (savedTheme !== null) setThemeName(savedTheme);
      } catch (error) {}
    };
    loadTheme();
  }, []);
  const setCurrentTheme = async name => {
    try {
      await AsyncStorage.setItem('appTheme', name);
      setThemeName(name);
    } catch (error) {}
  };
  const theme = {
    name: themeName,
    colors: themeName === 'pink' ? COLORS.pink : COLORS.blue,
    background: themeName === 'pink' ? COLORS.pink.light : COLORS.blue.light,
    text: COLORS.black,
    gray: COLORS.gray,
  };
  return (
    <ThemeContext.Provider value={{ theme, setCurrentTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
export const useTheme = () => useContext(ThemeContext);
