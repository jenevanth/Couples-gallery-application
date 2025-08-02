/**
 * App.js
 * This is the root of the application.
 * It imports the necessary polyfill for Supabase to work correctly
 * and then wraps the entire app in the ThemeProvider and Navigation.
 */
import 'react-native-url-polyfill/auto'; // MUST BE THE FIRST IMPORT
import React from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import AppNavigator from './src/navigation/AppNavigator';
import { ThemeProvider } from './src/theme/ThemeContext';

const App = () => {
  return (
    <ThemeProvider>
      <NavigationContainer>
        <StatusBar barStyle="light-content" backgroundColor="#121212" />
        <AppNavigator />
      </NavigationContainer>
    </ThemeProvider>
  );
};

export default App;
