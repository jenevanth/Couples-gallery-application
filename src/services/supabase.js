/**
 * src/services/supabase.js
 * This file initializes the Supabase client and configures Google Sign-In.
 * Your personal keys are now filled in here.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

// --- YOUR KEYS ARE FILLED IN ---
const SUPABASE_URL = 'https://gkpwvgjtupbkcuebsabm.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdrcHd2Z2p0dXBia2N1ZWJzYWJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4OTc0MjIsImV4cCI6MjA2OTQ3MzQyMn0.9IRkwoGTqPyPytzERStULkdFHg0sG1BuhTZwH0Pf1m0';

// --- !!! IMPORTANT: YOU MUST REPLACE THIS !!! ---
const GOOGLE_WEB_CLIENT_ID =
  '263236519188-egm10tod1nbsmjf0gad6l9inkvcum930.apps.googleusercontent.com';
// ---

// Initialize the Supabase client
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Configure Google Sign-In
GoogleSignin.configure({
  webClientId: GOOGLE_WEB_CLIENT_ID,
});
