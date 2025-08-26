import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Image,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { supabase } from '../services/supabase';
import Icon from 'react-native-vector-icons/Ionicons';

const THEME_COLORS = [
  { name: 'Blue', color: '#4FC3F7' },
  { name: 'Pink', color: '#FF80AB' },
  { name: 'Purple', color: '#B388FF' },
  { name: 'Green', color: '#69F0AE' },
  { name: 'Orange', color: '#FFB74D' },
];

const BG_GRADIENTS = [
  { name: 'Sky', colors: ['#4FC3F7', '#e3f2fd'] },
  { name: 'Love', colors: ['#FF80AB', '#ffe3f2'] },
  { name: 'Sunset', colors: ['#FFB74D', '#FF80AB'] },
];

const STICKERS = [
  '❤️',
  '😍',
  '💑',
  '🎉',
  '🌹',
  '🍰',
  '✈️',
  '🏖️',
  '🎁',
  '🍽️',
  '🥳',
  '👩‍❤️‍👨',
  '💍',
  '🎂',
];

const ThemesStickersScreen = () => {
  const { theme, setCurrentTheme } = useTheme();
  const [selectedColor, setSelectedColor] = useState(theme.colors.primary);
  const [selectedBg, setSelectedBg] = useState('');
  const [userId, setUserId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchProfile = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUserId(user.id);
      const { data } = await supabase
        .from('profiles')
        .select('theme_color, theme_bg')
        .eq('id', user.id)
        .single();
      if (data) {
        setSelectedColor(data.theme_color || theme.colors.primary);
        setSelectedBg(data.theme_bg || '');
      }
    };
    fetchProfile();
  }, []);

  const handleApplyTheme = async () => {
    setSaving(true);
    await supabase
      .from('profiles')
      .update({
        theme_color: selectedColor,
        theme_bg: selectedBg,
      })
      .eq('id', userId);
    // Update app theme
    if (selectedColor === '#FF80AB') setCurrentTheme('pink');
    else if (selectedColor === '#4FC3F7') setCurrentTheme('blue');
    else setCurrentTheme('blue'); // fallback
    setSaving(false);
    Alert.alert('Theme Applied', 'Your theme has been updated!');
  };

  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: selectedBg ? selectedBg : theme.colors.primary + '10',
      }}
    >
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>
          Choose Theme Color
        </Text>
        <View style={styles.swatchRow}>
          {THEME_COLORS.map(t => (
            <TouchableOpacity
              key={t.color}
              style={[
                styles.swatch,
                {
                  backgroundColor: t.color,
                  borderWidth: selectedColor === t.color ? 3 : 0,
                },
              ]}
              onPress={() => setSelectedColor(t.color)}
            >
              {selectedColor === t.color && (
                <Icon name="checkmark" size={22} color="#fff" />
              )}
            </TouchableOpacity>
          ))}
        </View>

        <Text
          style={[
            styles.sectionTitle,
            { color: theme.colors.primary, marginTop: 24 },
          ]}
        >
          Choose Background
        </Text>
        <View style={styles.swatchRow}>
          {BG_GRADIENTS.map(bg => (
            <TouchableOpacity
              key={bg.name}
              style={[
                styles.bgSwatch,
                {
                  backgroundColor: bg.colors[0],
                  borderWidth: selectedBg === bg.colors[0] ? 3 : 0,
                },
              ]}
              onPress={() => setSelectedBg(bg.colors[0])}
            >
              <Text style={{ color: '#fff', fontWeight: 'bold' }}>
                {bg.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.applyButton, { backgroundColor: selectedColor }]}
          onPress={handleApplyTheme}
          disabled={saving}
        >
          <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>
            {saving ? 'Saving...' : 'Apply Theme'}
          </Text>
        </TouchableOpacity>

        <Text
          style={[
            styles.sectionTitle,
            { color: theme.colors.primary, marginTop: 32 },
          ]}
        >
          Stickers Gallery
        </Text>
        <View style={styles.stickerRow}>
          {STICKERS.map((s, i) => (
            <View key={i} style={styles.stickerBubble}>
              <Text style={{ fontSize: 32 }}>{s}</Text>
            </View>
          ))}
        </View>
        <Text style={{ color: '#888', marginTop: 12, textAlign: 'center' }}>
          (Stickers can be added to photos when uploading!)
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { padding: 20, alignItems: 'center' },
  sectionTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 12 },
  swatchRow: { flexDirection: 'row', marginBottom: 8 },
  swatch: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: '#fff',
  },
  bgSwatch: {
    width: 80,
    height: 44,
    borderRadius: 12,
    marginHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: '#fff',
  },
  applyButton: {
    marginTop: 18,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    width: 180,
  },
  stickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 10,
  },
  stickerBubble: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 8,
    margin: 6,
    elevation: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default ThemesStickersScreen;
