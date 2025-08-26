import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { Calendar, LocaleConfig } from 'react-native-calendars';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { supabase } from '../services/supabase';
import { useTheme } from '../theme/ThemeContext';
import Icon from 'react-native-vector-icons/Ionicons';
import { format, differenceInDays, parseISO, isToday } from 'date-fns';

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

const EVENT_TYPES = [
  {
    type: 'anniversary',
    label: 'Anniversary',
    icon: 'heart',
    color: '#FF80AB',
  },
  { type: 'birthday', label: 'Birthday', icon: 'gift', color: '#4FC3F7' },
  { type: 'custom', label: 'Custom', icon: 'star', color: '#FFD700' },
];

const SharedCalendarScreen = () => {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const [events, setEvents] = useState([]);
  const [markedDates, setMarkedDates] = useState({});
  const [selectedDate, setSelectedDate] = useState(
    format(new Date(), 'yyyy-MM-dd'),
  );
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editEvent, setEditEvent] = useState(null);
  const [newEvent, setNewEvent] = useState({
    title: '',
    type: 'custom',
    emoji: '',
    note: '',
    date: format(new Date(), 'yyyy-MM-dd'),
  });
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(true);

  // Fetch user and events
  useEffect(() => {
    const fetchUserAndEvents = async () => {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) {
        setLoading(false);
        return;
      }
      setUserId(user.id);
      const { data } = await supabase
        .from('events')
        .select('*')
        .or(`user_id.eq.${user.id},user_id.is.null`);
      setEvents(data || []);
      setLoading(false);
    };
    fetchUserAndEvents();
  }, []);

  // Refetch events
  const fetchEvents = async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('events')
      .select('*')
      .or(`user_id.eq.${userId},user_id.is.null`);
    setEvents(data || []);
  };

  // Mark dates with events
  useEffect(() => {
    const marks = {};
    events.forEach((ev, idx) => {
      if (!marks[ev.date]) marks[ev.date] = { marked: true, dots: [] };
      const typeObj =
        EVENT_TYPES.find(t => t.type === ev.type) || EVENT_TYPES[2];
      marks[ev.date].dots.push({
        color: typeObj.color,
        key: ev.id ? String(ev.id) : `${ev.date}-${idx}`,
      });
    });
    if (selectedDate) {
      marks[selectedDate] = {
        ...(marks[selectedDate] || {}),
        selected: true,
        selectedColor: theme.colors.primary,
      };
    }
    setMarkedDates(marks);
  }, [events, selectedDate, theme.colors.primary]);

  // Events for selected date
  const eventsForSelectedDate = events.filter(ev => ev.date === selectedDate);

  // Next event and countdown
  const today = format(new Date(), 'yyyy-MM-dd');
  const futureEvents = events
    .filter(ev => ev.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const nextEvent = futureEvents[0];
  const daysToNext = nextEvent
    ? differenceInDays(parseISO(nextEvent.date), new Date())
    : null;

  // Add
  const handleAddEvent = async () => {
    if (!newEvent.title.trim()) {
      Alert.alert('Title required', 'Please enter a title for the event.');
      return;
    }
    const { error } = await supabase.from('events').insert({
      user_id: userId,
      title: newEvent.title,
      date: newEvent.date,
      type: newEvent.type,
      note: newEvent.note,
      emoji: newEvent.emoji,
    });
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setShowAddModal(false);
      setNewEvent(prev => ({
        ...prev,
        title: '',
        note: '',
        emoji: '',
        type: 'custom',
        date: selectedDate,
      }));
      fetchEvents();
    }
  };

  // Edit
  const handleEditEvent = async () => {
    if (!editEvent?.title?.trim()) {
      Alert.alert('Title required', 'Please enter a title for the event.');
      return;
    }
    const { error } = await supabase
      .from('events')
      .update({
        title: editEvent.title,
        date: editEvent.date,
        type: editEvent.type,
        note: editEvent.note,
        emoji: editEvent.emoji,
      })
      .eq('id', editEvent.id);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setShowEditModal(false);
      setEditEvent(null);
      fetchEvents();
    }
  };

  // Delete
  const handleDeleteEvent = async id => {
    Alert.alert('Delete Event', 'Are you sure you want to delete this event?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('events').delete().eq('id', id);
          fetchEvents();
        },
      },
    ]);
  };

  // Emoji picker data
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
  ];

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: theme.colors.primary + '10' }]}
      edges={['top', 'left', 'right']}
    >
      {/* Header / Hero */}
      <View
        style={[
          styles.headerWrap,
          { backgroundColor: theme.colors.primary, paddingTop: insets.top + 8 },
        ]}
      >
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Our Moments</Text>
          <TouchableOpacity
            onPress={() => {
              setShowAddModal(true);
              setNewEvent(ev => ({ ...ev, date: selectedDate }));
            }}
          >
            <Icon name="add-circle" size={28} color="#fff" />
          </TouchableOpacity>
        </View>
        <Text style={styles.headerSubtitle}>
          {format(new Date(), 'EEEE, MMM d')}
        </Text>

        {/* Legend */}
        <View style={styles.legendRow}>
          {EVENT_TYPES.map(t => (
            <View
              key={t.type}
              style={[styles.legendChip, { backgroundColor: t.color + '2A' }]}
            >
              <Icon
                name={t.icon}
                size={14}
                color="#fff"
                style={{ marginRight: 6 }}
              />
              <Text style={styles.legendText}>{t.label}</Text>
            </View>
          ))}
        </View>

        {/* Countdown */}
        {nextEvent && (
          <View style={[styles.countdown, { backgroundColor: '#FFFFFF22' }]}>
            <Icon
              name={
                EVENT_TYPES.find(tt => tt.type === nextEvent.type)?.icon ||
                'star'
              }
              size={20}
              color="#fff"
            />
            <Text style={[styles.countdownText, { color: '#fff' }]}>
              {daysToNext === 0
                ? `Today: ${nextEvent.title}`
                : daysToNext === 1
                ? `Tomorrow: ${nextEvent.title}`
                : `${daysToNext} days to ${nextEvent.title}`}
              {nextEvent.emoji ? ` ${nextEvent.emoji}` : ''}
            </Text>
          </View>
        )}
      </View>

      {/* Calendar */}
      <Calendar
        markedDates={markedDates}
        markingType="multi-dot"
        onDayPress={day => setSelectedDate(day.dateString)}
        theme={{
          calendarBackground: '#fff',
          todayTextColor: theme.colors.primary,
          selectedDayBackgroundColor: theme.colors.primary,
          selectedDayTextColor: '#fff',
          arrowColor: theme.colors.primary,
          monthTextColor: '#111',
          textDayFontWeight: '500',
          textSectionTitleColor: '#94A3B8',
        }}
        style={styles.calendarCard}
      />

      {/* Events for selected date */}
      <View style={styles.eventsSection}>
        <View style={styles.eventsHeader}>
          <Text style={[styles.eventsTitle, { color: theme.colors.primary }]}>
            {selectedDate === format(new Date(), 'yyyy-MM-dd')
              ? 'Today'
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
          <Text style={{ color: '#667781', marginTop: 12 }}>
            No events for this day.
          </Text>
        ) : (
          <FlatList
            data={eventsForSelectedDate}
            keyExtractor={item => item.id.toString()}
            contentContainerStyle={{ paddingBottom: 24 }}
            renderItem={({ item }) => {
              const typeObj =
                EVENT_TYPES.find(t => t.type === item.type) || EVENT_TYPES[2];
              const isFuture = item.date >= today;
              const isTodayFlag =
                item.date === today || isToday(parseISO(item.date));
              const daysLeft = differenceInDays(
                parseISO(item.date),
                new Date(),
              );
              return (
                <TouchableOpacity
                  style={[styles.eventCard, { borderLeftColor: typeObj.color }]}
                  onLongPress={() => {
                    setEditEvent(item);
                    setShowEditModal(true);
                  }}
                  activeOpacity={0.8}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        flex: 1,
                      }}
                    >
                      <Icon
                        name={typeObj.icon}
                        size={20}
                        color={typeObj.color}
                        style={{ marginRight: 8 }}
                      />
                      <Text style={styles.eventTitle}>
                        {item.title}
                        {item.emoji ? ` ${item.emoji}` : ''}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.datePill,
                        { borderColor: typeObj.color + '66' },
                      ]}
                    >
                      <Text
                        style={[styles.datePillText, { color: typeObj.color }]}
                      >
                        {format(parseISO(item.date), 'MMM d')}
                      </Text>
                    </View>
                  </View>

                  {item.note ? (
                    <Text style={styles.eventNote}>{item.note}</Text>
                  ) : null}

                  <View style={styles.cardFooter}>
                    {isTodayFlag ? (
                      <View
                        style={[styles.tag, { backgroundColor: '#22c55e22' }]}
                      >
                        <Text style={[styles.tagText, { color: '#16A34A' }]}>
                          Today
                        </Text>
                      </View>
                    ) : isFuture ? (
                      <View
                        style={[styles.tag, { backgroundColor: '#0ea5e922' }]}
                      >
                        <Text style={[styles.tagText, { color: '#0284C7' }]}>
                          {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left
                        </Text>
                      </View>
                    ) : (
                      <View
                        style={[styles.tag, { backgroundColor: '#f9731622' }]}
                      >
                        <Text style={[styles.tagText, { color: '#EA580C' }]}>
                          Passed
                        </Text>
                      </View>
                    )}

                    <TouchableOpacity
                      style={styles.deleteBtn}
                      onPress={() => handleDeleteEvent(item.id)}
                    >
                      <Icon name="trash" size={18} color="#FF6347" />
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        )}
      </View>

      {/* Floating Add Button */}
      <TouchableOpacity
        onPress={() => {
          setShowAddModal(true);
          setNewEvent(ev => ({ ...ev, date: selectedDate }));
        }}
        style={[
          styles.fab,
          { backgroundColor: theme.colors.primary, bottom: 24 + insets.bottom },
        ]}
        activeOpacity={0.9}
      >
        <Icon name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Add Event Modal */}
      <Modal visible={showAddModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: '#fff' }]}>
            <Text style={[styles.modalTitle, { color: theme.colors.primary }]}>
              Add Event
            </Text>

            <TextInput
              value={newEvent.title}
              onChangeText={t => setNewEvent(ev => ({ ...ev, title: t }))}
              placeholder="Title"
              style={styles.modalInput}
              placeholderTextColor="#94A3B8"
            />

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginVertical: 6 }}
            >
              {emojiList.map(e => (
                <TouchableOpacity
                  key={e}
                  style={[
                    styles.emojiBtn,
                    newEvent.emoji === e && {
                      borderColor: theme.colors.primary,
                      borderWidth: 2,
                    },
                  ]}
                  onPress={() => setNewEvent(ev => ({ ...ev, emoji: e }))}
                >
                  <Text style={{ fontSize: 26 }}>{e}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TextInput
              value={newEvent.note}
              onChangeText={t => setNewEvent(ev => ({ ...ev, note: t }))}
              placeholder="Note (optional)"
              style={[styles.modalInput, { height: 64 }]}
              placeholderTextColor="#94A3B8"
              multiline
            />

            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                marginVertical: 8,
              }}
            >
              {EVENT_TYPES.map(t => (
                <TouchableOpacity
                  key={t.type}
                  style={[
                    styles.typeButton,
                    newEvent.type === t.type && {
                      backgroundColor: t.color + '22',
                    },
                  ]}
                  onPress={() => setNewEvent(ev => ({ ...ev, type: t.type }))}
                >
                  <Icon name={t.icon} size={18} color={t.color} />
                  <Text style={{ color: t.color, marginLeft: 6 }}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.modalDatesRow}>
              <Icon name="calendar" size={18} color={theme.colors.primary} />
              <Text style={styles.modalDateText}>
                {format(parseISO(newEvent.date), 'MMM d, yyyy')}
              </Text>
              <Text style={styles.modalHintText}>
                (Change by tapping a date on the calendar)
              </Text>
            </View>

            <TouchableOpacity
              style={[
                styles.saveButton,
                { backgroundColor: theme.colors.primary },
              ]}
              onPress={handleAddEvent}
            >
              <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>
                Save
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setShowAddModal(false)}
            >
              <Text
                style={{ color: '#FF6347', fontWeight: 'bold', fontSize: 16 }}
              >
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Edit Event Modal */}
      <Modal visible={showEditModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: '#fff' }]}>
            <Text style={[styles.modalTitle, { color: theme.colors.primary }]}>
              Edit Event
            </Text>

            <TextInput
              value={editEvent?.title || ''}
              onChangeText={t => setEditEvent(ev => ({ ...ev, title: t }))}
              placeholder="Title"
              style={styles.modalInput}
              placeholderTextColor="#94A3B8"
            />

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginVertical: 6 }}
            >
              {emojiList.map(e => (
                <TouchableOpacity
                  key={e}
                  style={[
                    styles.emojiBtn,
                    editEvent?.emoji === e && {
                      borderColor: theme.colors.primary,
                      borderWidth: 2,
                    },
                  ]}
                  onPress={() => setEditEvent(ev => ({ ...ev, emoji: e }))}
                >
                  <Text style={{ fontSize: 26 }}>{e}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TextInput
              value={editEvent?.note || ''}
              onChangeText={t => setEditEvent(ev => ({ ...ev, note: t }))}
              placeholder="Note (optional)"
              style={[styles.modalInput, { height: 64 }]}
              placeholderTextColor="#94A3B8"
              multiline
            />

            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                marginVertical: 8,
              }}
            >
              {EVENT_TYPES.map(t => (
                <TouchableOpacity
                  key={t.type}
                  style={[
                    styles.typeButton,
                    editEvent?.type === t.type && {
                      backgroundColor: t.color + '22',
                    },
                  ]}
                  onPress={() => setEditEvent(ev => ({ ...ev, type: t.type }))}
                >
                  <Icon name={t.icon} size={18} color={t.color} />
                  <Text style={{ color: t.color, marginLeft: 6 }}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.modalDatesRow}>
              <Icon name="calendar" size={18} color={theme.colors.primary} />
              <Text style={styles.modalDateText}>
                {editEvent?.date
                  ? format(parseISO(editEvent.date), 'MMM d, yyyy')
                  : ''}
              </Text>
              <Text style={styles.modalHintText}>
                (Change by tapping a date on the calendar)
              </Text>
            </View>

            <TouchableOpacity
              style={[
                styles.saveButton,
                { backgroundColor: theme.colors.primary },
              ]}
              onPress={handleEditEvent}
            >
              <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>
                Save
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setShowEditModal(false)}
            >
              <Text
                style={{ color: '#FF6347', fontWeight: 'bold', fontSize: 16 }}
              >
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },

  // Header / Hero
  headerWrap: {
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    paddingHorizontal: 16,
    paddingBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { color: '#fff', fontSize: 24, fontWeight: '800' },
  headerSubtitle: {
    color: '#F8FAFC',
    opacity: 0.9,
    marginTop: 2,
    fontWeight: '600',
  },

  legendRow: { flexDirection: 'row', marginTop: 10 },
  legendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#FFFFFF40',
  },
  legendText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  countdown: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    marginTop: 10,
    borderRadius: 12,
  },
  countdownText: { fontSize: 16, marginLeft: 8, fontWeight: 'bold' },

  // Calendar card
  calendarCard: {
    margin: 12,
    borderRadius: 16,
    backgroundColor: '#fff',
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },

  // Events section
  eventsSection: { flex: 1, marginHorizontal: 16, marginTop: 4 },
  eventsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  eventsTitle: { fontSize: 18, fontWeight: '800' },

  eventCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    marginVertical: 6,
    borderLeftWidth: 5,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  eventTitle: { fontWeight: '700', color: '#0F172A', fontSize: 16 },
  eventNote: { color: '#334155', marginTop: 6, lineHeight: 20 },

  cardFooter: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  tagText: { fontWeight: '700', fontSize: 12 },

  datePill: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  datePillText: { fontWeight: '700', fontSize: 12 },

  deleteBtn: {
    marginLeft: 'auto',
    padding: 6,
  },

  // FAB
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },

  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 12,
  },
  modalContent: {
    width: '100%',
    borderRadius: 18,
    padding: 18,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  modalTitle: { fontSize: 20, fontWeight: '800', marginBottom: 12 },
  modalInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#F8FAFC',
    fontSize: 16,
    marginBottom: 10,
    color: '#0F172A',
  },
  emojiBtn: {
    borderRadius: 8,
    padding: 6,
    marginRight: 6,
    backgroundColor: '#F1F5F9',
  },
  typeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: '#F1F5F9',
  },
  modalDatesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 2,
  },
  modalDateText: { marginLeft: 6, fontWeight: '700', color: '#0F172A' },
  modalHintText: { marginLeft: 8, color: '#64748B', fontSize: 12 },

  saveButton: {
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  cancelButton: {
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#FF6347',
  },
});

export default SharedCalendarScreen;
