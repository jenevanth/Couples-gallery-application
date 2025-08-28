// SharedCalendarScreen.js - Complete version with all features
import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  FlatList,
  Alert,
  ScrollView,
  Animated,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  Platform,
  KeyboardAvoidingView,
  Switch,
  Vibration,
} from 'react-native';
import { Calendar, LocaleConfig } from 'react-native-calendars';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { supabase } from '../services/supabase';
import { useTheme } from '../theme/ThemeContext';
import Icon from 'react-native-vector-icons/Ionicons';
import {
  format,
  differenceInDays,
  parseISO,
  addMonths,
  addWeeks,
  addDays,
  addYears,
  isToday as checkIsToday,
  isTomorrow as checkIsTomorrow,
} from 'date-fns';
import LinearGradient from 'react-native-linear-gradient';
import DateTimePicker from '@react-native-community/datetimepicker';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width, height } = Dimensions.get('window');

// Haptic feedback helper
const hapticFeedback = {
  impact: () => {
    if (Platform.OS === 'ios') {
      Vibration.vibrate(10);
    }
  },
  selection: () => {
    if (Platform.OS === 'ios') {
      Vibration.vibrate(5);
    }
  },
  notification: type => {
    if (Platform.OS === 'ios') {
      Vibration.vibrate(15);
    }
  },
};

// Locale configuration
LocaleConfig.locales['en'] = {
  monthNames: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
  monthNamesShort: [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ],
  dayNames: [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ],
  dayNamesShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};
LocaleConfig.defaultLocale = 'en';

// Event types with colors and icons
const EVENT_TYPES = [
  {
    type: 'anniversary',
    label: 'Anniversary',
    icon: 'heart',
    color: '#FF80AB',
  },
  { type: 'birthday', label: 'Birthday', icon: 'gift', color: '#4FC3F7' },
  { type: 'date', label: 'Date Night', icon: 'restaurant', color: '#9C27B0' },
  { type: 'trip', label: 'Trip', icon: 'airplane', color: '#00BCD4' },
  {
    type: 'appointment',
    label: 'Appointment',
    icon: 'medical',
    color: '#FF6B6B',
  },
  { type: 'meeting', label: 'Meeting', icon: 'people', color: '#4CAF50' },
  {
    type: 'reminder',
    label: 'Reminder',
    icon: 'notifications',
    color: '#FFA726',
  },
  { type: 'custom', label: 'Custom', icon: 'star', color: '#FFD700' },
];

// Recurrence options
const RECURRENCE_OPTIONS = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

// View modes
const VIEW_MODES = [
  { value: 'month', label: 'Month', icon: 'calendar' },
  { value: 'list', label: 'List', icon: 'list' },
];

const SharedCalendarScreen = ({ navigation }) => {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;

  // State
  const [events, setEvents] = useState([]);
  const [markedDates, setMarkedDates] = useState({});
  const [selectedDate, setSelectedDate] = useState(
    format(new Date(), 'yyyy-MM-dd'),
  );
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [editEvent, setEditEvent] = useState(null);
  const [newEvent, setNewEvent] = useState({
    title: '',
    type: 'custom',
    emoji: '',
    note: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    time: format(new Date(), 'HH:mm'),
    location: '',
    recurrence: 'none',
    reminder: true,
  });

  // User and household state
  const [userId, setUserId] = useState('');
  const [householdId, setHouseholdId] = useState('');
  const [userName, setUserName] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [partnerId, setPartnerId] = useState('');

  // UI state
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState('month');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilters, setSelectedFilters] = useState([]);

  // Calendar subscription
  const [subscription, setSubscription] = useState(null);

  // Memoized values
  const today = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);

  const filteredEvents = useMemo(() => {
    console.log('📊 Filtering events:', {
      totalEvents: events.length,
      searchQuery,
      filters: selectedFilters,
    });

    let filtered = [...events];

    if (searchQuery) {
      filtered = filtered.filter(
        e =>
          e?.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          e?.note?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          e?.location?.toLowerCase().includes(searchQuery.toLowerCase()),
      );
    }

    if (selectedFilters.length > 0) {
      filtered = filtered.filter(e => selectedFilters.includes(e.type));
    }

    return filtered;
  }, [events, searchQuery, selectedFilters]);

  const eventsForSelectedDate = useMemo(
    () => filteredEvents.filter(e => e?.date === selectedDate),
    [filteredEvents, selectedDate],
  );

  const upcomingEvents = useMemo(() => {
    const upcoming = filteredEvents
      .filter(e => e?.date && e.date >= today)
      .sort((a, b) => (a.date > b.date ? 1 : -1))
      .slice(0, 5);

    console.log('📅 Upcoming events:', upcoming.length);
    return upcoming;
  }, [filteredEvents, today]);

  const nextEvent = useMemo(() => upcomingEvents[0] || null, [upcomingEvents]);

  const daysToNext = useMemo(() => {
    if (!nextEvent?.date) return null;
    return differenceInDays(parseISO(nextEvent.date), new Date());
  }, [nextEvent]);

  // Emoji list
  const emojiList = [
    '🎂',
    '💑',
    '💍',
    '🎉',
    '🌹',
    '🍰',
    '✈️',
    '🏖️',
    '🎁',
    '🍽️',
    '❤️',
    '😍',
    '🥳',
    '👩‍❤️‍👨',
    '🎊',
    '💕',
    '🌟',
    '🎈',
    '🍾',
    '🎭',
    '🎪',
    '🎨',
    '🎬',
    '🎵',
    '🏝️',
    '🏔️',
    '🎯',
    '🎮',
    '📚',
    '💐',
    '🍷',
    '🥂',
    '🎤',
    '🎸',
    '🏃',
    '🚗',
    '🏠',
    '💃',
    '🕺',
    '👶',
  ];

  // Initialize animations
  useEffect(() => {
    console.log('🎨 Initializing animations');
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 5,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Fetch user data and events on mount
  useEffect(() => {
    console.log('🚀 Component mounted, fetching initial data');
    fetchUserAndEvents();
    loadCachedData();
  }, []);

  // Load cached data for offline support
  const loadCachedData = async () => {
    try {
      console.log('📦 Loading cached data');
      const cachedEvents = await AsyncStorage.getItem('cached_events');
      if (cachedEvents) {
        setEvents(JSON.parse(cachedEvents));
        console.log('✅ Loaded cached events');
      }
    } catch (error) {
      console.error('❌ Error loading cached data:', error);
    }
  };

  // Cache events for offline support
  const cacheEvents = async eventsData => {
    try {
      await AsyncStorage.setItem('cached_events', JSON.stringify(eventsData));
      console.log('💾 Events cached');
    } catch (error) {
      console.error('❌ Error caching events:', error);
    }
  };

  // Create or update profile if it doesn't exist
  const createOrUpdateProfile = async (userId, email) => {
    try {
      console.log('🔧 Creating/updating profile for user:', userId);

      const { data, error } = await supabase
        .from('profiles')
        .upsert(
          {
            id: userId,
            username: email?.split('@')[0] || 'User',
            email: email,
            created_at: new Date().toISOString(),
          },
          {
            onConflict: 'id',
          },
        )
        .select()
        .single();

      if (error) {
        console.error('❌ Error creating/updating profile:', error);
        return null;
      }

      console.log('✅ Profile created/updated');
      return data;
    } catch (error) {
      console.error('❌ Unexpected error in createOrUpdateProfile:', error);
      return null;
    }
  };

  // Fetch user and events
  const fetchUserAndEvents = async () => {
    console.log('👤 Fetching user and events...');
    try {
      const { data: userData, error: userError } =
        await supabase.auth.getUser();

      if (userError) {
        console.error('❌ Auth error:', userError);
        setLoading(false);
        return;
      }

      const user = userData?.user;
      if (!user) {
        console.log('⚠️ No authenticated user found');
        setLoading(false);
        return;
      }

      console.log('✅ User authenticated:', user.id);
      setUserId(user.id);

      // Get or create user profile
      let { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (profileError && profileError.code === 'PGRST116') {
        console.log('📝 Profile not found, creating new profile...');
        profileData = await createOrUpdateProfile(user.id, user.email);
      } else if (profileError) {
        console.error('❌ Profile fetch error:', profileError);
        profileData = await createOrUpdateProfile(user.id, user.email);
      }

      if (profileData) {
        console.log('✅ Profile data loaded');
        setUserName(profileData.username || user.email?.split('@')[0] || 'You');

        if (profileData.household_id) {
          setHouseholdId(profileData.household_id);
          console.log('🏠 Household ID:', profileData.household_id);

          // Get partner's info
          const { data: partnerData } = await supabase
            .from('profiles')
            .select('id, username')
            .eq('household_id', profileData.household_id)
            .neq('id', user.id)
            .single();

          if (partnerData) {
            console.log('💑 Partner found');
            setPartnerName(partnerData.username || 'Partner');
            setPartnerId(partnerData.id);
          }

          await fetchEvents(profileData.household_id);
          setupRealtimeSubscription(profileData.household_id);
        } else {
          console.log('⚠️ No household - using personal calendar mode');
          await fetchPersonalEvents(user.id);
        }
      } else {
        setUserName(user.email?.split('@')[0] || 'You');
        await fetchPersonalEvents(user.id);
      }
    } catch (error) {
      console.error('❌ Unexpected error:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch personal events (when no household)
  const fetchPersonalEvents = async userId => {
    console.log('📥 Fetching personal events');

    try {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('user_id', userId)
        .is('household_id', null)
        .order('date', { ascending: true });

      if (!error) {
        console.log(`✅ Fetched ${data?.length || 0} personal events`);
        setEvents(data || []);
        cacheEvents(data || []);
      }
    } catch (error) {
      console.error('❌ Error fetching personal events:', error);
    }
  };

  // Setup realtime subscription for events
  const setupRealtimeSubscription = hId => {
    console.log('📡 Setting up realtime subscription');

    if (subscription) {
      supabase.removeChannel(subscription);
    }

    const householdIdString = String(hId);

    const newSubscription = supabase
      .channel(`events-household-${householdIdString}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'events',
          filter: `household_id=eq.${householdIdString}`,
        },
        payload => {
          console.log('📨 Realtime event received');
          handleRealtimeUpdate(payload);
        },
      )
      .subscribe();

    setSubscription(newSubscription);
  };

  // Handle realtime updates
  const handleRealtimeUpdate = async payload => {
    const { eventType, new: newRecord, old: oldRecord } = payload;

    console.log('🔄 Processing realtime update:', eventType);
    hapticFeedback.notification('success');

    switch (eventType) {
      case 'INSERT':
        setEvents(prev => {
          const updated = [...prev, newRecord];
          cacheEvents(updated);
          return updated;
        });

        if (newRecord.user_id !== userId) {
          Alert.alert('New Event', `${partnerName} added: ${newRecord.title}`);
          Vibration.vibrate([0, 200, 100, 200]);
        }
        break;

      case 'UPDATE':
        setEvents(prev => {
          const updated = prev.map(e =>
            e.id === newRecord.id ? newRecord : e,
          );
          cacheEvents(updated);
          return updated;
        });

        if (newRecord.updated_by && newRecord.updated_by !== userName) {
          Alert.alert(
            'Event Updated',
            `${partnerName} updated: ${newRecord.title}`,
          );
        }
        break;

      case 'DELETE':
        setEvents(prev => {
          const updated = prev.filter(e => e.id !== oldRecord.id);
          cacheEvents(updated);
          return updated;
        });
        break;
    }
  };

  // Fetch events for household
  const fetchEvents = async (hId = householdId) => {
    if (!hId) return;

    console.log('📥 Fetching events for household');

    try {
      const householdIdString = String(hId);

      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('household_id', householdIdString)
        .order('date', { ascending: true });

      if (!error) {
        console.log(`✅ Fetched ${data?.length || 0} events`);
        const processedEvents = processRecurringEvents(data || []);
        setEvents(processedEvents);
        cacheEvents(processedEvents);
      }
    } catch (error) {
      console.error('❌ Error fetching events:', error);
    }
  };

  // Process recurring events
  const processRecurringEvents = eventsData => {
    const processedEvents = [...eventsData];

    for (const event of eventsData) {
      if (event.recurrence && event.recurrence !== 'none') {
        const recurringDates = generateRecurringDates(event);

        recurringDates.forEach((date, index) => {
          if (date !== event.date) {
            processedEvents.push({
              ...event,
              id: `${event.id}_recurring_${index}`,
              date,
              is_recurring_instance: true,
              parent_id: event.id,
            });
          }
        });
      }
    }

    return processedEvents;
  };

  // Generate recurring dates based on recurrence pattern
  const generateRecurringDates = event => {
    const dates = [];
    const startDate = parseISO(event.date);
    const endDate = addYears(startDate, 1); // Generate for 1 year
    let currentDate = startDate;

    while (currentDate <= endDate) {
      dates.push(format(currentDate, 'yyyy-MM-dd'));

      switch (event.recurrence) {
        case 'daily':
          currentDate = addDays(currentDate, 1);
          break;
        case 'weekly':
          currentDate = addWeeks(currentDate, 1);
          break;
        case 'monthly':
          currentDate = addMonths(currentDate, 1);
          break;
        case 'yearly':
          currentDate = addYears(currentDate, 1);
          break;
        default:
          return dates;
      }
    }

    return dates;
  };

  // Refresh events with pull-to-refresh
  const onRefresh = useCallback(async () => {
    console.log('🔄 Refreshing events');
    setRefreshing(true);
    hapticFeedback.impact();

    if (householdId) {
      await fetchEvents();
    } else {
      await fetchPersonalEvents(userId);
    }

    setRefreshing(false);
  }, [householdId, userId]);

  // Add new event
  const handleAddEvent = async () => {
    console.log('➕ Adding new event');

    if (!newEvent.title.trim()) {
      Alert.alert('Title Required', 'Please enter a title for the event.');
      return;
    }

    try {
      const eventData = {
        household_id: householdId ? String(householdId) : null,
        user_id: userId,
        created_by: userName,
        title: newEvent.title,
        date: newEvent.date,
        time: newEvent.time,
        type: newEvent.type,
        note: newEvent.note || null,
        emoji: newEvent.emoji || null,
        location: newEvent.location || null,
        recurrence: newEvent.recurrence || 'none',
        reminder: newEvent.reminder || false,
        created_at: new Date().toISOString(),
      };

      console.log('📤 Sending event data:', eventData);

      const { data, error } = await supabase
        .from('events')
        .insert(eventData)
        .select()
        .single();

      if (error) {
        console.error('❌ Insert error:', error);
        Alert.alert('Error', 'Failed to add event. Please try again.');
      } else {
        console.log('✅ Event added successfully:', data);
        hapticFeedback.notification('success');

        setShowAddModal(false);
        resetNewEvent();

        // Refresh events
        if (householdId) {
          await fetchEvents();
        } else {
          await fetchPersonalEvents(userId);
        }
      }
    } catch (error) {
      console.error('❌ Add event error:', error);
      Alert.alert('Error', 'Failed to add event');
    }
  };

  // Update existing event
  const handleEditEvent = async () => {
    console.log('✏️ Updating event');

    if (!editEvent?.title?.trim()) {
      Alert.alert('Title Required', 'Please enter a title for the event.');
      return;
    }

    // Don't update recurring instances
    if (editEvent.is_recurring_instance) {
      Alert.alert(
        'Cannot Edit',
        'Cannot edit recurring event instances. Edit the original event instead.',
      );
      return;
    }

    try {
      const updateData = {
        title: editEvent.title,
        date: editEvent.date,
        time: editEvent.time,
        type: editEvent.type,
        note: editEvent.note,
        emoji: editEvent.emoji,
        location: editEvent.location,
        recurrence: editEvent.recurrence,
        reminder: editEvent.reminder,
        updated_by: userName,
        updated_at: new Date().toISOString(),
      };

      console.log('📤 Updating event:', editEvent.id);

      const { error } = await supabase
        .from('events')
        .update(updateData)
        .eq('id', editEvent.id);

      if (error) {
        console.error('❌ Update error:', error);
        Alert.alert('Error', 'Failed to update event');
      } else {
        console.log('✅ Event updated successfully');
        hapticFeedback.notification('success');

        setShowEditModal(false);
        setEditEvent(null);

        // Refresh events
        if (householdId) {
          await fetchEvents();
        } else {
          await fetchPersonalEvents(userId);
        }
      }
    } catch (error) {
      console.error('❌ Update event error:', error);
      Alert.alert('Error', 'Failed to update event');
    }
  };

  // Delete event
  const handleDeleteEvent = async (id, title) => {
    console.log('🗑️ Attempting to delete event:', id);

    // Check if it's a recurring instance
    if (id.includes('_recurring_')) {
      Alert.alert(
        'Cannot Delete',
        'Cannot delete recurring event instances. Delete the original event instead.',
      );
      return;
    }

    Alert.alert('Delete Event', 'Are you sure you want to delete this event?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const { error } = await supabase
              .from('events')
              .delete()
              .eq('id', id);

            if (!error) {
              console.log('✅ Event deleted');
              hapticFeedback.notification('warning');

              // Refresh events
              if (householdId) {
                await fetchEvents();
              } else {
                await fetchPersonalEvents(userId);
              }
            }
          } catch (error) {
            console.error('❌ Delete error:', error);
            Alert.alert('Error', 'Failed to delete event');
          }
        },
      },
    ]);
  };

  // Reset new event form
  const resetNewEvent = () => {
    setNewEvent({
      title: '',
      type: 'custom',
      emoji: '',
      note: '',
      date: selectedDate,
      time: format(new Date(), 'HH:mm'),
      location: '',
      recurrence: 'none',
      reminder: true,
    });
  };

  // Build marked dates for calendar
  useEffect(() => {
    console.log('📍 Building marked dates for calendar');
    const dotsByDate = {};

    filteredEvents.forEach(e => {
      if (!e?.date) return;

      const typeObj =
        EVENT_TYPES.find(t => t.type === e.type) || EVENT_TYPES[7];

      if (!dotsByDate[e.date]) {
        dotsByDate[e.date] = {
          dots: [],
          marked: true,
        };
      }

      dotsByDate[e.date].dots.push({
        key: `${e.id}-${typeObj.type}`,
        color: typeObj.color,
      });
    });

    const md = { ...dotsByDate };

    // Highlight selected date
    md[selectedDate] = {
      ...(md[selectedDate] || {}),
      selected: true,
      selectedColor: theme.colors.primary,
      selectedTextColor: '#FFFFFF',
    };

    // Highlight today
    if (selectedDate !== today) {
      md[today] = {
        ...(md[today] || {}),
        today: true,
        todayTextColor: theme.colors.primary,
      };
    }

    setMarkedDates(md);
  }, [filteredEvents, selectedDate, theme.colors.primary, today]);

  // Cleanup subscriptions on unmount
  useEffect(() => {
    return () => {
      if (subscription) {
        supabase.removeChannel(subscription);
      }
    };
  }, [subscription]);

  // Render list view events
  const renderListViewEvents = () => {
    const sortedEvents = [...filteredEvents].sort((a, b) =>
      a.date > b.date ? 1 : -1,
    );

    const groupedEvents = {};
    sortedEvents.forEach(event => {
      if (!groupedEvents[event.date]) {
        groupedEvents[event.date] = [];
      }
      groupedEvents[event.date].push(event);
    });

    return Object.keys(groupedEvents).map(date => (
      <View key={date} style={styles.listViewDateGroup}>
        <Text
          style={[styles.listViewDateHeader, { color: theme.colors.primary }]}
        >
          {date === today
            ? 'Today'
            : format(parseISO(date), 'EEEE, MMMM d, yyyy')}
        </Text>
        {groupedEvents[date].map(event => {
          const typeObj =
            EVENT_TYPES.find(t => t.type === event.type) || EVENT_TYPES[7];
          return (
            <TouchableOpacity
              key={event.id}
              style={[
                styles.listViewEventCard,
                { borderLeftColor: typeObj.color },
              ]}
              onPress={() => {
                if (!event.is_recurring_instance) {
                  setEditEvent(event);
                  setShowEditModal(true);
                }
              }}
              onLongPress={() => handleDeleteEvent(event.id, event.title)}
            >
              <View style={styles.listViewEventContent}>
                <Text style={styles.listViewEventTime}>
                  {event.time || '00:00'}
                </Text>
                <View style={styles.listViewEventDetails}>
                  <Text style={styles.listViewEventTitle}>
                    {event.emoji} {event.title}
                    {event.is_recurring_instance && ' 🔄'}
                  </Text>
                  {event.location && (
                    <Text style={styles.listViewEventLocation}>
                      <Icon name="location-outline" size={12} />{' '}
                      {event.location}
                    </Text>
                  )}
                </View>
                <Icon name={typeObj.icon} size={20} color={typeObj.color} />
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    ));
  };

  // Loading screen
  if (loading) {
    return (
      <LinearGradient colors={theme.gradient} style={styles.loader}>
        <ActivityIndicator size="large" color="#FFFFFF" />
        <Text style={styles.loadingText}>Loading your calendar...</Text>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient
      colors={[theme.colors.ultraLight, '#FFFFFF']}
      style={styles.container}
    >
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          {/* Header */}
          <Animated.View
            style={[
              styles.header,
              {
                opacity: fadeAnim,
                transform: [{ translateY: slideAnim }],
              },
            ]}
          >
            <LinearGradient
              colors={theme.gradient}
              style={styles.headerGradient}
            >
              <TouchableOpacity
                onPress={() => navigation.goBack()}
                style={styles.backButton}
              >
                <Icon name="arrow-back" size={26} color="#FFFFFF" />
              </TouchableOpacity>

              <View style={styles.headerContent}>
                <Text style={styles.headerTitle}>Our Calendar 💕</Text>
                <Text style={styles.headerSubtitle}>
                  {householdId
                    ? `${userName} & ${partnerName}`
                    : 'Personal Calendar'}
                </Text>
              </View>

              <View style={styles.headerActions}>
                <TouchableOpacity
                  onPress={() => setShowFilterModal(true)}
                  style={styles.headerActionButton}
                >
                  <Icon name="filter" size={24} color="#FFFFFF" />
                  {selectedFilters.length > 0 && (
                    <View style={styles.filterBadge}>
                      <Text style={styles.filterBadgeText}>
                        {selectedFilters.length}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    setShowAddModal(true);
                    setNewEvent(ev => ({ ...ev, date: selectedDate }));
                  }}
                  style={styles.headerActionButton}
                >
                  <Icon name="add-circle" size={28} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            </LinearGradient>

            {/* Search Bar */}
            <View style={styles.searchContainer}>
              <Icon name="search" size={20} color={theme.gray.medium} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search events..."
                placeholderTextColor={theme.gray.medium}
                style={[styles.searchInput, { color: theme.colors.primary }]}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Icon
                    name="close-circle"
                    size={20}
                    color={theme.gray.medium}
                  />
                </TouchableOpacity>
              )}
            </View>

            {/* View Mode Selector */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.viewModeContainer}
            >
              {VIEW_MODES.map(mode => (
                <TouchableOpacity
                  key={mode.value}
                  style={[
                    styles.viewModeButton,
                    viewMode === mode.value && {
                      backgroundColor: theme.colors.primary + '20',
                      borderColor: theme.colors.primary,
                    },
                  ]}
                  onPress={() => {
                    setViewMode(mode.value);
                    hapticFeedback.selection();
                  }}
                >
                  <Icon
                    name={mode.icon}
                    size={18}
                    color={
                      viewMode === mode.value
                        ? theme.colors.primary
                        : theme.gray.medium
                    }
                  />
                  <Text
                    style={[
                      styles.viewModeText,
                      {
                        color:
                          viewMode === mode.value
                            ? theme.colors.primary
                            : theme.gray.medium,
                      },
                    ]}
                  >
                    {mode.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Countdown Banner */}
            {nextEvent && (
              <Animated.View
                style={[
                  styles.countdownBanner,
                  {
                    opacity: fadeAnim,
                    transform: [{ scale: scaleAnim }],
                  },
                ]}
              >
                <LinearGradient
                  colors={[
                    theme.colors.primary + '20',
                    theme.colors.secondary + '10',
                  ]}
                  style={styles.countdownGradient}
                >
                  <Icon
                    name={
                      EVENT_TYPES.find(t => t.type === nextEvent.type)?.icon ||
                      'star'
                    }
                    size={20}
                    color={theme.colors.primary}
                  />
                  <View style={styles.countdownContent}>
                    <Text
                      style={[
                        styles.countdownText,
                        { color: theme.colors.primary },
                      ]}
                    >
                      {daysToNext === 0
                        ? `Today: ${nextEvent.title}`
                        : daysToNext === 1
                        ? `Tomorrow: ${nextEvent.title}`
                        : `${daysToNext} days until ${nextEvent.title}`}
                      {nextEvent.emoji ? ` ${nextEvent.emoji}` : ''}
                    </Text>
                    {nextEvent.time && (
                      <Text
                        style={[
                          styles.countdownTime,
                          { color: theme.colors.primary + '80' },
                        ]}
                      >
                        at {nextEvent.time}
                      </Text>
                    )}
                  </View>
                </LinearGradient>
              </Animated.View>
            )}

            {/* Upcoming Events Preview */}
            {upcomingEvents.length > 1 && viewMode === 'month' && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.upcomingContainer}
              >
                {upcomingEvents.slice(1, 4).map(event => (
                  <TouchableOpacity
                    key={event.id}
                    style={styles.upcomingCard}
                    onPress={() => setSelectedDate(event.date)}
                  >
                    <Text style={styles.upcomingEmoji}>
                      {event.emoji || '📅'}
                    </Text>
                    <Text style={styles.upcomingTitle} numberOfLines={1}>
                      {event.title}
                    </Text>
                    <Text style={styles.upcomingDate}>
                      {format(parseISO(event.date), 'MMM d')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </Animated.View>

          {/* Main Content */}
          <ScrollView
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                colors={[theme.colors.primary]}
                tintColor={theme.colors.primary}
              />
            }
            showsVerticalScrollIndicator={false}
          >
            {viewMode === 'month' && (
              <>
                {/* Calendar */}
                <Calendar
                  markedDates={markedDates}
                  markingType="multi-dot"
                  onDayPress={day => {
                    console.log('📅 Day selected:', day.dateString);
                    setSelectedDate(day.dateString);
                    hapticFeedback.selection();
                  }}
                  theme={{
                    calendarBackground: '#FFFFFF',
                    todayTextColor: theme.colors.primary,
                    selectedDayBackgroundColor: theme.colors.primary,
                    selectedDayTextColor: '#FFFFFF',
                    arrowColor: theme.colors.primary,
                    monthTextColor: theme.text,
                    textDayFontWeight: '500',
                    textMonthFontWeight: 'bold',
                    textDayHeaderFontWeight: '600',
                    textSectionTitleColor: theme.gray.medium,
                    dotColor: theme.colors.primary,
                    selectedDotColor: '#FFFFFF',
                  }}
                  style={styles.calendar}
                  enableSwipeMonths
                />

                {/* Selected Date Events */}
                <View style={styles.eventsSection}>
                  <View style={styles.eventsSectionHeader}>
                    <Text
                      style={[
                        styles.eventsSectionTitle,
                        { color: theme.colors.primary },
                      ]}
                    >
                      {selectedDate === today
                        ? "Today's Events"
                        : format(parseISO(selectedDate), 'MMMM d, yyyy')}
                    </Text>
                    <TouchableOpacity
                      onPress={() => {
                        setShowAddModal(true);
                        setNewEvent(ev => ({ ...ev, date: selectedDate }));
                      }}
                    >
                      <Icon name="add" size={24} color={theme.colors.primary} />
                    </TouchableOpacity>
                  </View>

                  {eventsForSelectedDate.length === 0 ? (
                    <View style={styles.emptyState}>
                      <Icon
                        name="calendar-outline"
                        size={48}
                        color={theme.gray.light}
                      />
                      <Text
                        style={[styles.emptyText, { color: theme.gray.medium }]}
                      >
                        No events scheduled
                      </Text>
                      <TouchableOpacity
                        onPress={() => {
                          setShowAddModal(true);
                          setNewEvent(ev => ({ ...ev, date: selectedDate }));
                        }}
                        style={styles.emptyAddButton}
                      >
                        <Text
                          style={[
                            styles.emptyAddText,
                            { color: theme.colors.primary },
                          ]}
                        >
                          Add an event
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <FlatList
                      data={eventsForSelectedDate}
                      keyExtractor={item => item.id.toString()}
                      scrollEnabled={false}
                      renderItem={({ item }) => {
                        const typeObj =
                          EVENT_TYPES.find(t => t.type === item.type) ||
                          EVENT_TYPES[7];
                        const eventColor = typeObj.color;

                        return (
                          <TouchableOpacity
                            style={[
                              styles.eventCard,
                              { borderLeftColor: eventColor },
                            ]}
                            onPress={() => {
                              if (!item.is_recurring_instance) {
                                setEditEvent(item);
                                setShowEditModal(true);
                              }
                            }}
                            onLongPress={() =>
                              handleDeleteEvent(item.id, item.title)
                            }
                            activeOpacity={0.8}
                          >
                            <Animated.View style={styles.eventCardContent}>
                              <View style={styles.eventCardHeader}>
                                <View style={styles.eventCardLeft}>
                                  <Icon
                                    name={typeObj.icon}
                                    size={20}
                                    color={eventColor}
                                    style={{ marginRight: 8 }}
                                  />
                                  <View style={{ flex: 1 }}>
                                    <Text style={styles.eventTitle}>
                                      {item.emoji} {item.title}
                                      {item.is_recurring_instance && ' 🔄'}
                                    </Text>
                                    {item.time && (
                                      <Text style={styles.eventTime}>
                                        <Icon name="time-outline" size={12} />{' '}
                                        {item.time}
                                      </Text>
                                    )}
                                    {item.location && (
                                      <Text style={styles.eventLocation}>
                                        <Icon
                                          name="location-outline"
                                          size={12}
                                        />{' '}
                                        {item.location}
                                      </Text>
                                    )}
                                  </View>
                                </View>

                                <TouchableOpacity
                                  onPress={() =>
                                    handleDeleteEvent(item.id, item.title)
                                  }
                                  style={styles.deleteButton}
                                >
                                  <Icon
                                    name="trash-outline"
                                    size={18}
                                    color={theme.shared?.red || '#FF6B6B'}
                                  />
                                </TouchableOpacity>
                              </View>

                              {item.note && (
                                <Text
                                  style={styles.eventNote}
                                  numberOfLines={2}
                                >
                                  {item.note}
                                </Text>
                              )}

                              <View style={styles.eventFooter}>
                                <View style={styles.eventMeta}>
                                  {item.created_by && (
                                    <Text style={styles.eventCreator}>
                                      by {item.created_by}
                                    </Text>
                                  )}
                                  {item.reminder && (
                                    <Icon
                                      name="notifications"
                                      size={14}
                                      color={theme.gray.medium}
                                      style={{ marginLeft: 8 }}
                                    />
                                  )}
                                  {item.recurrence !== 'none' && (
                                    <Icon
                                      name="repeat"
                                      size={14}
                                      color={theme.gray.medium}
                                      style={{ marginLeft: 8 }}
                                    />
                                  )}
                                </View>

                                <View
                                  style={[
                                    styles.eventType,
                                    { backgroundColor: eventColor + '20' },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.eventTypeText,
                                      { color: eventColor },
                                    ]}
                                  >
                                    {typeObj.label}
                                  </Text>
                                </View>
                              </View>
                            </Animated.View>
                          </TouchableOpacity>
                        );
                      }}
                    />
                  )}
                </View>
              </>
            )}

            {viewMode === 'list' && (
              <View style={styles.listViewContainer}>
                {filteredEvents.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Icon
                      name="calendar-outline"
                      size={48}
                      color={theme.gray.light}
                    />
                    <Text
                      style={[styles.emptyText, { color: theme.gray.medium }]}
                    >
                      No events found
                    </Text>
                  </View>
                ) : (
                  renderListViewEvents()
                )}
              </View>
            )}
          </ScrollView>

          {/* Add/Edit Event Modal */}
          <Modal
            visible={showAddModal || showEditModal}
            animationType="slide"
            transparent
          >
            <View style={styles.modalOverlay}>
              <Animated.View
                style={[
                  styles.modalContent,
                  {
                    transform: [{ scale: scaleAnim }],
                    opacity: fadeAnim,
                  },
                ]}
              >
                <LinearGradient
                  colors={['#FFFFFF', theme.colors.ultraLight]}
                  style={styles.modalGradient}
                >
                  <ScrollView showsVerticalScrollIndicator={false}>
                    <Text
                      style={[
                        styles.modalTitle,
                        { color: theme.colors.primary },
                      ]}
                    >
                      {showEditModal ? 'Edit Event' : 'Add New Event'}
                    </Text>

                    {/* Title Input */}
                    <TextInput
                      value={showEditModal ? editEvent?.title : newEvent.title}
                      onChangeText={t =>
                        showEditModal
                          ? setEditEvent(ev => ({ ...ev, title: t }))
                          : setNewEvent(ev => ({ ...ev, title: t }))
                      }
                      placeholder="Event title"
                      placeholderTextColor={theme.gray.medium}
                      style={[styles.input, { color: theme.colors.primary }]}
                    />

                    {/* Emoji Selector */}
                    <Text style={styles.inputLabel}>Choose an emoji</Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={styles.emojiScroll}
                    >
                      {emojiList.map(emoji => (
                        <TouchableOpacity
                          key={emoji}
                          style={[
                            styles.emojiButton,
                            (showEditModal
                              ? editEvent?.emoji
                              : newEvent.emoji) === emoji &&
                              styles.emojiButtonActive,
                          ]}
                          onPress={() => {
                            if (showEditModal) {
                              setEditEvent(ev => ({ ...ev, emoji }));
                            } else {
                              setNewEvent(ev => ({ ...ev, emoji }));
                            }
                            hapticFeedback.selection();
                          }}
                        >
                          <Text style={styles.emojiText}>{emoji}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>

                    {/* Date & Time */}
                    <View style={styles.dateTimeContainer}>
                      <TouchableOpacity
                        style={styles.dateTimeButton}
                        onPress={() => setShowDatePicker(true)}
                      >
                        <Icon
                          name="calendar"
                          size={20}
                          color={theme.colors.primary}
                        />
                        <Text
                          style={[
                            styles.dateTimeText,
                            { color: theme.colors.primary },
                          ]}
                        >
                          {format(
                            parseISO(
                              showEditModal
                                ? editEvent?.date || today
                                : newEvent.date,
                            ),
                            'MMM d, yyyy',
                          )}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.dateTimeButton}
                        onPress={() => setShowTimePicker(true)}
                      >
                        <Icon
                          name="time"
                          size={20}
                          color={theme.colors.primary}
                        />
                        <Text
                          style={[
                            styles.dateTimeText,
                            { color: theme.colors.primary },
                          ]}
                        >
                          {showEditModal
                            ? editEvent?.time || '00:00'
                            : newEvent.time}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {/* Location */}
                    <TextInput
                      value={
                        showEditModal ? editEvent?.location : newEvent.location
                      }
                      onChangeText={t =>
                        showEditModal
                          ? setEditEvent(ev => ({ ...ev, location: t }))
                          : setNewEvent(ev => ({ ...ev, location: t }))
                      }
                      placeholder="Location (optional)"
                      placeholderTextColor={theme.gray.medium}
                      style={[styles.input, { color: theme.colors.primary }]}
                    />

                    {/* Event Type */}
                    <Text style={styles.inputLabel}>Event Type</Text>
                    <View style={styles.typeSelector}>
                      {EVENT_TYPES.map(type => (
                        <TouchableOpacity
                          key={type.type}
                          style={[
                            styles.typeButton,
                            (showEditModal
                              ? editEvent?.type
                              : newEvent.type) === type.type && {
                              backgroundColor: type.color + '20',
                              borderColor: type.color,
                            },
                          ]}
                          onPress={() => {
                            if (showEditModal) {
                              setEditEvent(ev => ({ ...ev, type: type.type }));
                            } else {
                              setNewEvent(ev => ({ ...ev, type: type.type }));
                            }
                          }}
                        >
                          <Icon name={type.icon} size={18} color={type.color} />
                          <Text
                            style={[styles.typeText, { color: type.color }]}
                          >
                            {type.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    {/* Recurrence */}
                    <Text style={styles.inputLabel}>Repeat</Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={styles.recurrenceContainer}
                    >
                      {RECURRENCE_OPTIONS.map(option => (
                        <TouchableOpacity
                          key={option.value}
                          style={[
                            styles.recurrenceButton,
                            (showEditModal
                              ? editEvent?.recurrence
                              : newEvent.recurrence) === option.value && {
                              backgroundColor: theme.colors.primary + '20',
                              borderColor: theme.colors.primary,
                            },
                          ]}
                          onPress={() => {
                            if (showEditModal) {
                              setEditEvent(ev => ({
                                ...ev,
                                recurrence: option.value,
                              }));
                            } else {
                              setNewEvent(ev => ({
                                ...ev,
                                recurrence: option.value,
                              }));
                            }
                          }}
                        >
                          <Text
                            style={[
                              styles.recurrenceText,
                              {
                                color:
                                  (showEditModal
                                    ? editEvent?.recurrence
                                    : newEvent.recurrence) === option.value
                                    ? theme.colors.primary
                                    : theme.gray.dark,
                              },
                            ]}
                          >
                            {option.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>

                    {/* Reminder */}
                    <View style={styles.reminderContainer}>
                      <Text style={styles.inputLabel}>Reminder</Text>
                      <Switch
                        value={
                          showEditModal
                            ? editEvent?.reminder
                            : newEvent.reminder
                        }
                        onValueChange={v => {
                          if (showEditModal) {
                            setEditEvent(ev => ({ ...ev, reminder: v }));
                          } else {
                            setNewEvent(ev => ({ ...ev, reminder: v }));
                          }
                        }}
                        trackColor={{
                          false: theme.gray.light,
                          true: theme.colors.primary,
                        }}
                        thumbColor="#FFFFFF"
                      />
                    </View>

                    {/* Notes */}
                    <TextInput
                      value={showEditModal ? editEvent?.note : newEvent.note}
                      onChangeText={t =>
                        showEditModal
                          ? setEditEvent(ev => ({ ...ev, note: t }))
                          : setNewEvent(ev => ({ ...ev, note: t }))
                      }
                      placeholder="Notes (optional)"
                      placeholderTextColor={theme.gray.medium}
                      style={[
                        styles.input,
                        styles.textArea,
                        { color: theme.colors.primary },
                      ]}
                      multiline
                      numberOfLines={3}
                    />

                    {/* Action Buttons */}
                    <View style={styles.modalButtons}>
                      <TouchableOpacity
                        style={[styles.modalButton, styles.cancelButton]}
                        onPress={() => {
                          setShowAddModal(false);
                          setShowEditModal(false);
                          resetNewEvent();
                          setEditEvent(null);
                        }}
                      >
                        <Text
                          style={[
                            styles.cancelButtonText,
                            { color: theme.gray.dark },
                          ]}
                        >
                          Cancel
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={
                          showEditModal ? handleEditEvent : handleAddEvent
                        }
                        style={styles.modalButton}
                      >
                        <LinearGradient
                          colors={theme.gradient}
                          style={styles.saveButtonGradient}
                        >
                          <Text style={styles.saveButtonText}>
                            {showEditModal ? 'Save Changes' : 'Add Event'}
                          </Text>
                        </LinearGradient>
                      </TouchableOpacity>
                    </View>
                  </ScrollView>
                </LinearGradient>
              </Animated.View>
            </View>
          </Modal>

          {/* Filter Modal */}
          <Modal visible={showFilterModal} animationType="slide" transparent>
            <View style={styles.modalOverlay}>
              <View style={styles.filterModalContent}>
                <Text
                  style={[styles.modalTitle, { color: theme.colors.primary }]}
                >
                  Filter Events
                </Text>

                <Text style={styles.inputLabel}>Event Types</Text>
                <View style={styles.filterOptions}>
                  {EVENT_TYPES.map(type => (
                    <TouchableOpacity
                      key={type.type}
                      style={[
                        styles.filterOption,
                        selectedFilters.includes(type.type) && {
                          backgroundColor: type.color + '20',
                          borderColor: type.color,
                        },
                      ]}
                      onPress={() => {
                        if (selectedFilters.includes(type.type)) {
                          setSelectedFilters(prev =>
                            prev.filter(f => f !== type.type),
                          );
                        } else {
                          setSelectedFilters(prev => [...prev, type.type]);
                        }
                      }}
                    >
                      <Icon name={type.icon} size={20} color={type.color} />
                      <Text
                        style={[styles.filterOptionText, { color: type.color }]}
                      >
                        {type.label}
                      </Text>
                      {selectedFilters.includes(type.type) && (
                        <Icon
                          name="checkmark-circle"
                          size={16}
                          color={type.color}
                        />
                      )}
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.cancelButton]}
                    onPress={() => {
                      setSelectedFilters([]);
                    }}
                  >
                    <Text
                      style={[
                        styles.cancelButtonText,
                        { color: theme.gray.dark },
                      ]}
                    >
                      Clear All
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => setShowFilterModal(false)}
                    style={styles.modalButton}
                  >
                    <LinearGradient
                      colors={theme.gradient}
                      style={styles.saveButtonGradient}
                    >
                      <Text style={styles.saveButtonText}>Apply Filters</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          {/* Date Picker */}
          {showDatePicker && (
            <DateTimePicker
              value={parseISO(
                showEditModal ? editEvent?.date || today : newEvent.date,
              )}
              mode="date"
              display="default"
              onChange={(event, date) => {
                setShowDatePicker(false);
                if (date) {
                  const formattedDate = format(date, 'yyyy-MM-dd');
                  if (showEditModal) {
                    setEditEvent(ev => ({ ...ev, date: formattedDate }));
                  } else {
                    setNewEvent(ev => ({ ...ev, date: formattedDate }));
                  }
                }
              }}
            />
          )}

          {/* Time Picker */}
          {showTimePicker && (
            <DateTimePicker
              value={
                new Date(
                  `2000-01-01T${
                    showEditModal ? editEvent?.time || '00:00' : newEvent.time
                  }`,
                )
              }
              mode="time"
              display="default"
              onChange={(event, date) => {
                setShowTimePicker(false);
                if (date) {
                  const formattedTime = format(date, 'HH:mm');
                  if (showEditModal) {
                    setEditEvent(ev => ({ ...ev, time: formattedTime }));
                  } else {
                    setNewEvent(ev => ({ ...ev, time: formattedTime }));
                  }
                }
              }}
            />
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#FFFFFF',
    fontSize: 16,
    marginTop: 12,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
  },

  // Header
  header: {
    paddingBottom: 8,
  },
  headerGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  backButton: {
    padding: 4,
  },
  headerContent: {
    flex: 1,
    marginLeft: 12,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerActionButton: {
    padding: 4,
    marginLeft: 12,
    position: 'relative',
  },
  filterBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: '#FF6B6B',
    borderRadius: 8,
    width: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
  },

  // Search
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 16,
  },

  // View Mode
  viewModeContainer: {
    marginTop: 12,
    paddingHorizontal: 16,
    maxHeight: 40,
  },
  viewModeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  viewModeText: {
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 6,
  },

  // Countdown
  countdownBanner: {
    marginTop: 12,
    marginHorizontal: 16,
  },
  countdownGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 16,
  },
  countdownContent: {
    flex: 1,
    marginLeft: 8,
  },
  countdownText: {
    fontSize: 14,
    fontWeight: '600',
  },
  countdownTime: {
    fontSize: 12,
    marginTop: 2,
  },

  // Upcoming Events
  upcomingContainer: {
    marginTop: 12,
    paddingHorizontal: 16,
    maxHeight: 80,
  },
  upcomingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    marginRight: 12,
    alignItems: 'center',
    minWidth: 80,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  upcomingEmoji: {
    fontSize: 24,
  },
  upcomingTitle: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
    textAlign: 'center',
  },
  upcomingDate: {
    fontSize: 10,
    color: '#999',
    marginTop: 2,
  },

  // Calendar
  calendar: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    backgroundColor: '#FFFFFF',
  },

  // Events Section
  eventsSection: {
    flex: 1,
    marginTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  eventsSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  eventsSectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },

  // Empty State
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 16,
    marginTop: 12,
  },
  emptyAddButton: {
    marginTop: 16,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: 'rgba(102, 126, 234, 0.1)',
  },
  emptyAddText: {
    fontSize: 14,
    fontWeight: '600',
  },

  // Event Card
  eventCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    overflow: 'hidden',
  },
  eventCardContent: {
    padding: 16,
  },
  eventCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  eventCardLeft: {
    flexDirection: 'row',
    flex: 1,
    alignItems: 'flex-start',
  },
  eventTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  eventTime: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  eventLocation: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  eventNote: {
    fontSize: 14,
    color: '#666',
    marginTop: 8,
    lineHeight: 20,
  },
  eventFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    alignItems: 'center',
  },
  eventMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  eventCreator: {
    fontSize: 11,
    color: '#999',
  },
  eventType: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  eventTypeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  deleteButton: {
    padding: 4,
  },

  // List View
  listViewContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  listViewDateGroup: {
    marginBottom: 20,
  },
  listViewDateHeader: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  listViewEventCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 8,
    borderLeftWidth: 3,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  listViewEventContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  listViewEventTime: {
    fontSize: 14,
    color: '#666',
    width: 50,
  },
  listViewEventDetails: {
    flex: 1,
    marginLeft: 12,
  },
  listViewEventTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1A1A1A',
  },
  listViewEventLocation: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    borderRadius: 24,
    overflow: 'hidden',
    maxHeight: height * 0.8,
  },
  modalGradient: {
    padding: 24,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
  },

  // Inputs
  input: {
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 16,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },

  // Date Time
  dateTimeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  dateTimeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flex: 0.48,
  },
  dateTimeText: {
    fontSize: 14,
    marginLeft: 8,
    fontWeight: '500',
  },

  // Emoji Selector
  emojiScroll: {
    marginBottom: 16,
    maxHeight: 50,
  },
  emojiButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  emojiButtonActive: {
    backgroundColor: 'rgba(102, 126, 234, 0.2)',
    borderWidth: 2,
    borderColor: '#667EEA',
  },
  emojiText: {
    fontSize: 24,
  },

  // Type Selector
  typeSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  typeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.05)',
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  typeText: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 6,
  },

  // Recurrence
  recurrenceContainer: {
    marginBottom: 16,
    maxHeight: 40,
  },
  recurrenceButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.05)',
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  recurrenceText: {
    fontSize: 14,
    fontWeight: '500',
  },

  // Reminder
  reminderContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },

  // Modal Buttons
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  modalButton: {
    flex: 1,
    marginHorizontal: 6,
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  saveButtonGradient: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },

  // Filter Modal
  filterModalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    maxHeight: height * 0.7,
  },
  filterOptions: {
    marginBottom: 20,
  },
  filterOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.05)',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  filterOptionText: {
    flex: 1,
    marginLeft: 12,
    fontSize: 16,
    fontWeight: '500',
  },
});

export default SharedCalendarScreen;
// import React, { useState, useEffect } from 'react';
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   Modal,
//   TextInput,
//   FlatList,
//   Alert,
//   ScrollView,
// } from 'react-native';
// import { Calendar, LocaleConfig } from 'react-native-calendars';
// import {
//   SafeAreaView,
//   useSafeAreaInsets,
// } from 'react-native-safe-area-context';
// import { supabase } from '../services/supabase';
// import { useTheme } from '../theme/ThemeContext';
// import Icon from 'react-native-vector-icons/Ionicons';
// import { format, differenceInDays, parseISO, isToday } from 'date-fns';

// LocaleConfig.locales['en'] = {
//   monthNames: [
//     'January',
//     'February',
//     'March',
//     'April',
//     'May',
//     'June',
//     'July',
//     'August',
//     'September',
//     'October',
//     'November',
//     'December',
//   ],
//   monthNamesShort: [
//     'Jan',
//     'Feb',
//     'Mar',
//     'Apr',
//     'May',
//     'Jun',
//     'Jul',
//     'Aug',
//     'Sep',
//     'Oct',
//     'Nov',
//     'Dec',
//   ],
//   dayNames: [
//     'Sunday',
//     'Monday',
//     'Tuesday',
//     'Wednesday',
//     'Thursday',
//     'Friday',
//     'Saturday',
//   ],
//   dayNamesShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
// };
// LocaleConfig.defaultLocale = 'en';

// const EVENT_TYPES = [
//   {
//     type: 'anniversary',
//     label: 'Anniversary',
//     icon: 'heart',
//     color: '#FF80AB',
//   },
//   { type: 'birthday', label: 'Birthday', icon: 'gift', color: '#4FC3F7' },
//   { type: 'custom', label: 'Custom', icon: 'star', color: '#FFD700' },
// ];

// const SharedCalendarScreen = () => {
//   const { theme } = useTheme();
//   const insets = useSafeAreaInsets();

//   const [events, setEvents] = useState([]);
//   const [markedDates, setMarkedDates] = useState({});
//   const [selectedDate, setSelectedDate] = useState(
//     format(new Date(), 'yyyy-MM-dd'),
//   );
//   const [showAddModal, setShowAddModal] = useState(false);
//   const [showEditModal, setShowEditModal] = useState(false);
//   const [editEvent, setEditEvent] = useState(null);
//   const [newEvent, setNewEvent] = useState({
//     title: '',
//     type: 'custom',
//     emoji: '',
//     note: '',
//     date: format(new Date(), 'yyyy-MM-dd'),
//   });
//   const [userId, setUserId] = useState('');
//   const [loading, setLoading] = useState(true);

//   // Fetch user and events
//   useEffect(() => {
//     const fetchUserAndEvents = async () => {
//       const { data: userData } = await supabase.auth.getUser();
//       const user = userData?.user;
//       if (!user) {
//         setLoading(false);
//         return;
//       }
//       setUserId(user.id);
//       const { data } = await supabase
//         .from('events')
//         .select('*')
//         .or(`user_id.eq.${user.id},user_id.is.null`);
//       setEvents(data || []);
//       setLoading(false);
//     };
//     fetchUserAndEvents();
//   }, []);

//   // Refetch events
//   const fetchEvents = async () => {
//     if (!userId) return;
//     const { data } = await supabase
//       .from('events')
//       .select('*')
//       .or(`user_id.eq.${userId},user_id.is.null`);
//     setEvents(data || []);
//   };

//   // Mark dates with events
//   useEffect(() => {
//     const marks = {};
//     events.forEach((ev, idx) => {
//       if (!marks[ev.date]) marks[ev.date] = { marked: true, dots: [] };
//       const typeObj =
//         EVENT_TYPES.find(t => t.type === ev.type) || EVENT_TYPES[2];
//       marks[ev.date].dots.push({
//         color: typeObj.color,
//         key: ev.id ? String(ev.id) : `${ev.date}-${idx}`,
//       });
//     });
//     if (selectedDate) {
//       marks[selectedDate] = {
//         ...(marks[selectedDate] || {}),
//         selected: true,
//         selectedColor: theme.colors.primary,
//       };
//     }
//     setMarkedDates(marks);
//   }, [events, selectedDate, theme.colors.primary]);

//   // Events for selected date
//   const eventsForSelectedDate = events.filter(ev => ev.date === selectedDate);

//   // Next event and countdown
//   const today = format(new Date(), 'yyyy-MM-dd');
//   const futureEvents = events
//     .filter(ev => ev.date >= today)
//     .sort((a, b) => a.date.localeCompare(b.date));
//   const nextEvent = futureEvents[0];
//   const daysToNext = nextEvent
//     ? differenceInDays(parseISO(nextEvent.date), new Date())
//     : null;

//   // Add
//   const handleAddEvent = async () => {
//     if (!newEvent.title.trim()) {
//       Alert.alert('Title required', 'Please enter a title for the event.');
//       return;
//     }
//     const { error } = await supabase.from('events').insert({
//       user_id: userId,
//       title: newEvent.title,
//       date: newEvent.date,
//       type: newEvent.type,
//       note: newEvent.note,
//       emoji: newEvent.emoji,
//     });
//     if (error) {
//       Alert.alert('Error', error.message);
//     } else {
//       setShowAddModal(false);
//       setNewEvent(prev => ({
//         ...prev,
//         title: '',
//         note: '',
//         emoji: '',
//         type: 'custom',
//         date: selectedDate,
//       }));
//       fetchEvents();
//     }
//   };

//   // Edit
//   const handleEditEvent = async () => {
//     if (!editEvent?.title?.trim()) {
//       Alert.alert('Title required', 'Please enter a title for the event.');
//       return;
//     }
//     const { error } = await supabase
//       .from('events')
//       .update({
//         title: editEvent.title,
//         date: editEvent.date,
//         type: editEvent.type,
//         note: editEvent.note,
//         emoji: editEvent.emoji,
//       })
//       .eq('id', editEvent.id);
//     if (error) {
//       Alert.alert('Error', error.message);
//     } else {
//       setShowEditModal(false);
//       setEditEvent(null);
//       fetchEvents();
//     }
//   };

//   // Delete
//   const handleDeleteEvent = async id => {
//     Alert.alert('Delete Event', 'Are you sure you want to delete this event?', [
//       { text: 'Cancel', style: 'cancel' },
//       {
//         text: 'Delete',
//         style: 'destructive',
//         onPress: async () => {
//           await supabase.from('events').delete().eq('id', id);
//           fetchEvents();
//         },
//       },
//     ]);
//   };

//   // Emoji picker data
//   const emojiList = [
//     '🎂',
//     '💑',
//     '💍',
//     '🎉',
//     '🌹',
//     '🍰',
//     '✈️',
//     '🏖️',
//     '🎁',
//     '🍽️',
//     '❤️',
//     '😍',
//     '🥳',
//     '👩‍❤️‍👨',
//   ];

//   return (
//     <SafeAreaView
//       style={[styles.safe, { backgroundColor: theme.colors.primary + '10' }]}
//       edges={['top', 'left', 'right']}
//     >
//       {/* Header / Hero */}
//       <View
//         style={[
//           styles.headerWrap,
//           { backgroundColor: theme.colors.primary, paddingTop: insets.top + 8 },
//         ]}
//       >
//         <View style={styles.headerRow}>
//           <Text style={styles.headerTitle}>Our Moments</Text>
//           <TouchableOpacity
//             onPress={() => {
//               setShowAddModal(true);
//               setNewEvent(ev => ({ ...ev, date: selectedDate }));
//             }}
//           >
//             <Icon name="add-circle" size={28} color="#fff" />
//           </TouchableOpacity>
//         </View>
//         <Text style={styles.headerSubtitle}>
//           {format(new Date(), 'EEEE, MMM d')}
//         </Text>

//         {/* Legend */}
//         <View style={styles.legendRow}>
//           {EVENT_TYPES.map(t => (
//             <View
//               key={t.type}
//               style={[styles.legendChip, { backgroundColor: t.color + '2A' }]}
//             >
//               <Icon
//                 name={t.icon}
//                 size={14}
//                 color="#fff"
//                 style={{ marginRight: 6 }}
//               />
//               <Text style={styles.legendText}>{t.label}</Text>
//             </View>
//           ))}
//         </View>

//         {/* Countdown */}
//         {nextEvent && (
//           <View style={[styles.countdown, { backgroundColor: '#FFFFFF22' }]}>
//             <Icon
//               name={
//                 EVENT_TYPES.find(tt => tt.type === nextEvent.type)?.icon ||
//                 'star'
//               }
//               size={20}
//               color="#fff"
//             />
//             <Text style={[styles.countdownText, { color: '#fff' }]}>
//               {daysToNext === 0
//                 ? `Today: ${nextEvent.title}`
//                 : daysToNext === 1
//                 ? `Tomorrow: ${nextEvent.title}`
//                 : `${daysToNext} days to ${nextEvent.title}`}
//               {nextEvent.emoji ? ` ${nextEvent.emoji}` : ''}
//             </Text>
//           </View>
//         )}
//       </View>

//       {/* Calendar */}
//       <Calendar
//         markedDates={markedDates}
//         markingType="multi-dot"
//         onDayPress={day => setSelectedDate(day.dateString)}
//         theme={{
//           calendarBackground: '#fff',
//           todayTextColor: theme.colors.primary,
//           selectedDayBackgroundColor: theme.colors.primary,
//           selectedDayTextColor: '#fff',
//           arrowColor: theme.colors.primary,
//           monthTextColor: '#111',
//           textDayFontWeight: '500',
//           textSectionTitleColor: '#94A3B8',
//         }}
//         style={styles.calendarCard}
//       />

//       {/* Events for selected date */}
//       <View style={styles.eventsSection}>
//         <View style={styles.eventsHeader}>
//           <Text style={[styles.eventsTitle, { color: theme.colors.primary }]}>
//             {selectedDate === format(new Date(), 'yyyy-MM-dd')
//               ? 'Today'
//               : format(parseISO(selectedDate), 'MMMM d, yyyy')}
//           </Text>
//           <TouchableOpacity
//             onPress={() => {
//               setShowAddModal(true);
//               setNewEvent(ev => ({ ...ev, date: selectedDate }));
//             }}
//           >
//             <Icon name="add" size={24} color={theme.colors.primary} />
//           </TouchableOpacity>
//         </View>

//         {eventsForSelectedDate.length === 0 ? (
//           <Text style={{ color: '#667781', marginTop: 12 }}>
//             No events for this day.
//           </Text>
//         ) : (
//           <FlatList
//             data={eventsForSelectedDate}
//             keyExtractor={item => item.id.toString()}
//             contentContainerStyle={{ paddingBottom: 24 }}
//             renderItem={({ item }) => {
//               const typeObj =
//                 EVENT_TYPES.find(t => t.type === item.type) || EVENT_TYPES[2];
//               const isFuture = item.date >= today;
//               const isTodayFlag =
//                 item.date === today || isToday(parseISO(item.date));
//               const daysLeft = differenceInDays(
//                 parseISO(item.date),
//                 new Date(),
//               );
//               return (
//                 <TouchableOpacity
//                   style={[styles.eventCard, { borderLeftColor: typeObj.color }]}
//                   onLongPress={() => {
//                     setEditEvent(item);
//                     setShowEditModal(true);
//                   }}
//                   activeOpacity={0.8}
//                 >
//                   <View
//                     style={{
//                       flexDirection: 'row',
//                       alignItems: 'center',
//                       justifyContent: 'space-between',
//                     }}
//                   >
//                     <View
//                       style={{
//                         flexDirection: 'row',
//                         alignItems: 'center',
//                         flex: 1,
//                       }}
//                     >
//                       <Icon
//                         name={typeObj.icon}
//                         size={20}
//                         color={typeObj.color}
//                         style={{ marginRight: 8 }}
//                       />
//                       <Text style={styles.eventTitle}>
//                         {item.title}
//                         {item.emoji ? ` ${item.emoji}` : ''}
//                       </Text>
//                     </View>
//                     <View
//                       style={[
//                         styles.datePill,
//                         { borderColor: typeObj.color + '66' },
//                       ]}
//                     >
//                       <Text
//                         style={[styles.datePillText, { color: typeObj.color }]}
//                       >
//                         {format(parseISO(item.date), 'MMM d')}
//                       </Text>
//                     </View>
//                   </View>

//                   {item.note ? (
//                     <Text style={styles.eventNote}>{item.note}</Text>
//                   ) : null}

//                   <View style={styles.cardFooter}>
//                     {isTodayFlag ? (
//                       <View
//                         style={[styles.tag, { backgroundColor: '#22c55e22' }]}
//                       >
//                         <Text style={[styles.tagText, { color: '#16A34A' }]}>
//                           Today
//                         </Text>
//                       </View>
//                     ) : isFuture ? (
//                       <View
//                         style={[styles.tag, { backgroundColor: '#0ea5e922' }]}
//                       >
//                         <Text style={[styles.tagText, { color: '#0284C7' }]}>
//                           {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left
//                         </Text>
//                       </View>
//                     ) : (
//                       <View
//                         style={[styles.tag, { backgroundColor: '#f9731622' }]}
//                       >
//                         <Text style={[styles.tagText, { color: '#EA580C' }]}>
//                           Passed
//                         </Text>
//                       </View>
//                     )}

//                     <TouchableOpacity
//                       style={styles.deleteBtn}
//                       onPress={() => handleDeleteEvent(item.id)}
//                     >
//                       <Icon name="trash" size={18} color="#FF6347" />
//                     </TouchableOpacity>
//                   </View>
//                 </TouchableOpacity>
//               );
//             }}
//           />
//         )}
//       </View>

//       {/* Floating Add Button */}
//       <TouchableOpacity
//         onPress={() => {
//           setShowAddModal(true);
//           setNewEvent(ev => ({ ...ev, date: selectedDate }));
//         }}
//         style={[
//           styles.fab,
//           { backgroundColor: theme.colors.primary, bottom: 24 + insets.bottom },
//         ]}
//         activeOpacity={0.9}
//       >
//         <Icon name="add" size={28} color="#fff" />
//       </TouchableOpacity>

//       {/* Add Event Modal */}
//       <Modal visible={showAddModal} animationType="slide" transparent>
//         <View style={styles.modalOverlay}>
//           <View style={[styles.modalContent, { backgroundColor: '#fff' }]}>
//             <Text style={[styles.modalTitle, { color: theme.colors.primary }]}>
//               Add Event
//             </Text>

//             <TextInput
//               value={newEvent.title}
//               onChangeText={t => setNewEvent(ev => ({ ...ev, title: t }))}
//               placeholder="Title"
//               style={styles.modalInput}
//               placeholderTextColor="#94A3B8"
//             />

//             <ScrollView
//               horizontal
//               showsHorizontalScrollIndicator={false}
//               style={{ marginVertical: 6 }}
//             >
//               {emojiList.map(e => (
//                 <TouchableOpacity
//                   key={e}
//                   style={[
//                     styles.emojiBtn,
//                     newEvent.emoji === e && {
//                       borderColor: theme.colors.primary,
//                       borderWidth: 2,
//                     },
//                   ]}
//                   onPress={() => setNewEvent(ev => ({ ...ev, emoji: e }))}
//                 >
//                   <Text style={{ fontSize: 26 }}>{e}</Text>
//                 </TouchableOpacity>
//               ))}
//             </ScrollView>

//             <TextInput
//               value={newEvent.note}
//               onChangeText={t => setNewEvent(ev => ({ ...ev, note: t }))}
//               placeholder="Note (optional)"
//               style={[styles.modalInput, { height: 64 }]}
//               placeholderTextColor="#94A3B8"
//               multiline
//             />

//             <View
//               style={{
//                 flexDirection: 'row',
//                 flexWrap: 'wrap',
//                 marginVertical: 8,
//               }}
//             >
//               {EVENT_TYPES.map(t => (
//                 <TouchableOpacity
//                   key={t.type}
//                   style={[
//                     styles.typeButton,
//                     newEvent.type === t.type && {
//                       backgroundColor: t.color + '22',
//                     },
//                   ]}
//                   onPress={() => setNewEvent(ev => ({ ...ev, type: t.type }))}
//                 >
//                   <Icon name={t.icon} size={18} color={t.color} />
//                   <Text style={{ color: t.color, marginLeft: 6 }}>
//                     {t.label}
//                   </Text>
//                 </TouchableOpacity>
//               ))}
//             </View>

//             <View style={styles.modalDatesRow}>
//               <Icon name="calendar" size={18} color={theme.colors.primary} />
//               <Text style={styles.modalDateText}>
//                 {format(parseISO(newEvent.date), 'MMM d, yyyy')}
//               </Text>
//               <Text style={styles.modalHintText}>
//                 (Change by tapping a date on the calendar)
//               </Text>
//             </View>

//             <TouchableOpacity
//               style={[
//                 styles.saveButton,
//                 { backgroundColor: theme.colors.primary },
//               ]}
//               onPress={handleAddEvent}
//             >
//               <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>
//                 Save
//               </Text>
//             </TouchableOpacity>
//             <TouchableOpacity
//               style={styles.cancelButton}
//               onPress={() => setShowAddModal(false)}
//             >
//               <Text
//                 style={{ color: '#FF6347', fontWeight: 'bold', fontSize: 16 }}
//               >
//                 Cancel
//               </Text>
//             </TouchableOpacity>
//           </View>
//         </View>
//       </Modal>

//       {/* Edit Event Modal */}
//       <Modal visible={showEditModal} animationType="slide" transparent>
//         <View style={styles.modalOverlay}>
//           <View style={[styles.modalContent, { backgroundColor: '#fff' }]}>
//             <Text style={[styles.modalTitle, { color: theme.colors.primary }]}>
//               Edit Event
//             </Text>

//             <TextInput
//               value={editEvent?.title || ''}
//               onChangeText={t => setEditEvent(ev => ({ ...ev, title: t }))}
//               placeholder="Title"
//               style={styles.modalInput}
//               placeholderTextColor="#94A3B8"
//             />

//             <ScrollView
//               horizontal
//               showsHorizontalScrollIndicator={false}
//               style={{ marginVertical: 6 }}
//             >
//               {emojiList.map(e => (
//                 <TouchableOpacity
//                   key={e}
//                   style={[
//                     styles.emojiBtn,
//                     editEvent?.emoji === e && {
//                       borderColor: theme.colors.primary,
//                       borderWidth: 2,
//                     },
//                   ]}
//                   onPress={() => setEditEvent(ev => ({ ...ev, emoji: e }))}
//                 >
//                   <Text style={{ fontSize: 26 }}>{e}</Text>
//                 </TouchableOpacity>
//               ))}
//             </ScrollView>

//             <TextInput
//               value={editEvent?.note || ''}
//               onChangeText={t => setEditEvent(ev => ({ ...ev, note: t }))}
//               placeholder="Note (optional)"
//               style={[styles.modalInput, { height: 64 }]}
//               placeholderTextColor="#94A3B8"
//               multiline
//             />

//             <View
//               style={{
//                 flexDirection: 'row',
//                 flexWrap: 'wrap',
//                 marginVertical: 8,
//               }}
//             >
//               {EVENT_TYPES.map(t => (
//                 <TouchableOpacity
//                   key={t.type}
//                   style={[
//                     styles.typeButton,
//                     editEvent?.type === t.type && {
//                       backgroundColor: t.color + '22',
//                     },
//                   ]}
//                   onPress={() => setEditEvent(ev => ({ ...ev, type: t.type }))}
//                 >
//                   <Icon name={t.icon} size={18} color={t.color} />
//                   <Text style={{ color: t.color, marginLeft: 6 }}>
//                     {t.label}
//                   </Text>
//                 </TouchableOpacity>
//               ))}
//             </View>

//             <View style={styles.modalDatesRow}>
//               <Icon name="calendar" size={18} color={theme.colors.primary} />
//               <Text style={styles.modalDateText}>
//                 {editEvent?.date
//                   ? format(parseISO(editEvent.date), 'MMM d, yyyy')
//                   : ''}
//               </Text>
//               <Text style={styles.modalHintText}>
//                 (Change by tapping a date on the calendar)
//               </Text>
//             </View>

//             <TouchableOpacity
//               style={[
//                 styles.saveButton,
//                 { backgroundColor: theme.colors.primary },
//               ]}
//               onPress={handleEditEvent}
//             >
//               <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>
//                 Save
//               </Text>
//             </TouchableOpacity>
//             <TouchableOpacity
//               style={styles.cancelButton}
//               onPress={() => setShowEditModal(false)}
//             >
//               <Text
//                 style={{ color: '#FF6347', fontWeight: 'bold', fontSize: 16 }}
//               >
//                 Cancel
//               </Text>
//             </TouchableOpacity>
//           </View>
//         </View>
//       </Modal>
//     </SafeAreaView>
//   );
// };

// const styles = StyleSheet.create({
//   safe: { flex: 1 },

//   // Header / Hero
//   headerWrap: {
//     borderBottomLeftRadius: 22,
//     borderBottomRightRadius: 22,
//     paddingHorizontal: 16,
//     paddingBottom: 14,
//     shadowColor: '#000',
//     shadowOpacity: 0.08,
//     shadowRadius: 6,
//     shadowOffset: { width: 0, height: 3 },
//     elevation: 3,
//   },
//   headerRow: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     justifyContent: 'space-between',
//   },
//   headerTitle: { color: '#fff', fontSize: 24, fontWeight: '800' },
//   headerSubtitle: {
//     color: '#F8FAFC',
//     opacity: 0.9,
//     marginTop: 2,
//     fontWeight: '600',
//   },

//   legendRow: { flexDirection: 'row', marginTop: 10 },
//   legendChip: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     paddingHorizontal: 10,
//     paddingVertical: 6,
//     borderRadius: 14,
//     marginRight: 8,
//     borderWidth: 1,
//     borderColor: '#FFFFFF40',
//   },
//   legendText: { color: '#fff', fontSize: 12, fontWeight: '700' },

//   countdown: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     padding: 10,
//     marginTop: 10,
//     borderRadius: 12,
//   },
//   countdownText: { fontSize: 16, marginLeft: 8, fontWeight: 'bold' },

//   // Calendar card
//   calendarCard: {
//     margin: 12,
//     borderRadius: 16,
//     backgroundColor: '#fff',
//     elevation: 3,
//     shadowColor: '#000',
//     shadowOpacity: 0.08,
//     shadowRadius: 6,
//     shadowOffset: { width: 0, height: 3 },
//   },

//   // Events section
//   eventsSection: { flex: 1, marginHorizontal: 16, marginTop: 4 },
//   eventsHeader: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     justifyContent: 'space-between',
//     marginBottom: 6,
//   },
//   eventsTitle: { fontSize: 18, fontWeight: '800' },

//   eventCard: {
//     backgroundColor: '#fff',
//     borderRadius: 14,
//     padding: 12,
//     marginVertical: 6,
//     borderLeftWidth: 5,
//     elevation: 2,
//     shadowColor: '#000',
//     shadowOpacity: 0.06,
//     shadowRadius: 4,
//     shadowOffset: { width: 0, height: 2 },
//   },
//   eventTitle: { fontWeight: '700', color: '#0F172A', fontSize: 16 },
//   eventNote: { color: '#334155', marginTop: 6, lineHeight: 20 },

//   cardFooter: {
//     marginTop: 10,
//     flexDirection: 'row',
//     alignItems: 'center',
//   },
//   tag: {
//     paddingHorizontal: 10,
//     paddingVertical: 4,
//     borderRadius: 12,
//   },
//   tagText: { fontWeight: '700', fontSize: 12 },

//   datePill: {
//     borderWidth: 1,
//     borderRadius: 12,
//     paddingHorizontal: 8,
//     paddingVertical: 2,
//   },
//   datePillText: { fontWeight: '700', fontSize: 12 },

//   deleteBtn: {
//     marginLeft: 'auto',
//     padding: 6,
//   },

//   // FAB
//   fab: {
//     position: 'absolute',
//     right: 20,
//     width: 56,
//     height: 56,
//     borderRadius: 28,
//     alignItems: 'center',
//     justifyContent: 'center',
//     shadowColor: '#000',
//     shadowOpacity: 0.18,
//     shadowRadius: 6,
//     shadowOffset: { width: 0, height: 3 },
//     elevation: 5,
//   },

//   // Modals
//   modalOverlay: {
//     flex: 1,
//     backgroundColor: 'rgba(0,0,0,0.18)',
//     justifyContent: 'center',
//     alignItems: 'center',
//     padding: 12,
//   },
//   modalContent: {
//     width: '100%',
//     borderRadius: 18,
//     padding: 18,
//     elevation: 8,
//     shadowColor: '#000',
//     shadowOpacity: 0.1,
//     shadowRadius: 8,
//     shadowOffset: { width: 0, height: 4 },
//   },
//   modalTitle: { fontSize: 20, fontWeight: '800', marginBottom: 12 },
//   modalInput: {
//     borderWidth: 1,
//     borderColor: '#E5E7EB',
//     borderRadius: 10,
//     paddingHorizontal: 12,
//     paddingVertical: 10,
//     backgroundColor: '#F8FAFC',
//     fontSize: 16,
//     marginBottom: 10,
//     color: '#0F172A',
//   },
//   emojiBtn: {
//     borderRadius: 8,
//     padding: 6,
//     marginRight: 6,
//     backgroundColor: '#F1F5F9',
//   },
//   typeButton: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     borderRadius: 10,
//     paddingHorizontal: 12,
//     paddingVertical: 8,
//     marginRight: 8,
//     marginBottom: 8,
//     backgroundColor: '#F1F5F9',
//   },
//   modalDatesRow: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     marginTop: 6,
//     marginBottom: 2,
//   },
//   modalDateText: { marginLeft: 6, fontWeight: '700', color: '#0F172A' },
//   modalHintText: { marginLeft: 8, color: '#64748B', fontSize: 12 },

//   saveButton: {
//     padding: 14,
//     borderRadius: 12,
//     alignItems: 'center',
//     marginTop: 10,
//   },
//   cancelButton: {
//     padding: 12,
//     borderRadius: 12,
//     alignItems: 'center',
//     marginTop: 8,
//     borderWidth: 1,
//     borderColor: '#FF6347',
//   },
// });

// export default SharedCalendarScreen;
