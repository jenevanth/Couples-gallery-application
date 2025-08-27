// theme/ThemeContext.js
import React, { createContext, useState, useContext, useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS } from './colors';
import LinearGradient from 'react-native-linear-gradient';

const log = (...a) => console.log('[ThemeContext]', ...a);

const ThemeContext = createContext(null);

export const ThemeProvider = ({ children }) => {
  const [themeName, setThemeName] = useState('blue'); // 'blue' | 'pink'
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadTheme = async () => {
      log('Loading appTheme from storage...');
      try {
        const savedTheme = await AsyncStorage.getItem('appTheme');
        log('appTheme from storage:', savedTheme);
        if (savedTheme) setThemeName(savedTheme);
      } catch (error) {
        console.error('[ThemeContext] Failed to load theme.', error);
      } finally {
        setLoading(false);
      }
    };
    loadTheme();
  }, []);

  const setCurrentTheme = async name => {
    try {
      log('setCurrentTheme called with:', name);
      await AsyncStorage.setItem('appTheme', name);
      setThemeName(name);
      log('Theme saved to storage and state updated:', name);
    } catch (error) {
      console.error('[ThemeContext] Failed to save theme.', error);
    }
  };

  const theme = {
    name: themeName,
    colors: themeName === 'pink' ? COLORS.pink : COLORS.blue,
    gradient:
      themeName === 'pink' ? COLORS.pink.gradient : COLORS.blue.gradient,
    background: COLORS.black,
    text: COLORS.white,
    gray: COLORS.gray,
    shared: COLORS.shared,
    glassmorphism: COLORS.glassmorphism,
  };

  if (loading) {
    log('Loading indicator until theme is read from storage...');
    return (
      <LinearGradient
        colors={['#667EEA', '#764BA2']}
        style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
      >
        <ActivityIndicator size="large" color="#FFFFFF" />
      </LinearGradient>
    );
  }

  log('Providing theme:', themeName);
  return (
    <ThemeContext.Provider value={{ theme, setCurrentTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);

// // theme/ThemeContext.js
// import React, { createContext, useState, useContext, useEffect } from 'react';
// import { ActivityIndicator, View } from 'react-native';
// import AsyncStorage from '@react-native-async-storage/async-storage';
// import { COLORS } from './colors';

// const log = (...a) => console.log('[ThemeContext]', ...a);

// const ThemeContext = createContext(null);

// export const ThemeProvider = ({ children }) => {
//   const [themeName, setThemeName] = useState('blue'); // 'blue' | 'pink'
//   const [loading, setLoading] = useState(true);

//   useEffect(() => {
//     const loadTheme = async () => {
//       log('Loading appTheme from storage...');
//       try {
//         const savedTheme = await AsyncStorage.getItem('appTheme');
//         log('appTheme from storage:', savedTheme);
//         if (savedTheme) setThemeName(savedTheme);
//       } catch (error) {
//         console.error('[ThemeContext] Failed to load theme.', error);
//       } finally {
//         setLoading(false);
//       }
//     };
//     loadTheme();
//   }, []);

//   const setCurrentTheme = async name => {
//     try {
//       log('setCurrentTheme called with:', name);
//       await AsyncStorage.setItem('appTheme', name);
//       setThemeName(name);
//       log('Theme saved to storage and state updated:', name);
//     } catch (error) {
//       console.error('[ThemeContext] Failed to save theme.', error);
//     }
//   };

//   const theme = {
//     name: themeName,
//     colors: themeName === 'pink' ? COLORS.pink : COLORS.blue,
//     background: COLORS.black,
//     text: COLORS.white,
//     gray: COLORS.gray,
//   };

//   if (loading) {
//     log('Loading indicator until theme is read from storage...');
//     return (
//       <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
//         <ActivityIndicator size="large" />
//       </View>
//     );
//   }

//   log('Providing theme:', themeName);
//   return (
//     <ThemeContext.Provider value={{ theme, setCurrentTheme }}>
//       {children}
//     </ThemeContext.Provider>
//   );
// };

// export const useTheme = () => useContext(ThemeContext);
