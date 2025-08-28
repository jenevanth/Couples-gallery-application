// src/screens/PrivateChatScreen.js
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Keyboard,
  Alert,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import { useTheme } from '../theme/ThemeContext';
import Icon from 'react-native-vector-icons/Ionicons';
import { format, isToday, isYesterday, parseISO } from 'date-fns';

const log = (...a) => console.log('[Chat]', ...a);

const getDateLabel = dateStr => {
  const date = parseISO(dateStr);
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'MMMM d, yyyy');
};

const MIN_COMPOSER = 42;
const MAX_COMPOSER = 140;

const PrivateChatScreen = ({ navigation }) => {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [composerHeight, setComposerHeight] = useState(MIN_COMPOSER);

  const [userId, setUserId] = useState(null);
  const [householdId, setHouseholdId] = useState(null);
  const [loading, setLoading] = useState(true);

  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [inputBarHeight, setInputBarHeight] = useState(56);
  const flatListRef = useRef();

  // Helpers for dedupe/merge
  const upsertMessage = useCallback((msg, replaceId = null) => {
    setMessages(prev => {
      const base = replaceId ? prev.filter(m => m.id !== replaceId) : prev;
      const idx = base.findIndex(m => m.id === msg.id);
      if (idx !== -1) {
        const copy = [...base];
        copy[idx] = { ...copy[idx], ...msg };
        return copy;
      }
      return [...base, msg];
    });
  }, []);

  const addIfNotPresent = useCallback(msg => {
    setMessages(prev => {
      const exists = prev.some(m => m.id === msg.id);
      if (exists)
        return prev.map(m => (m.id === msg.id ? { ...m, ...msg } : m));
      return [...prev, msg];
    });
  }, []);

  // Keyboard listeners
  useEffect(() => {
    const showEvt =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = e => {
      const kh = e?.endCoordinates?.height || 0;
      setKeyboardHeight(kh);
      log('Keyboard show height:', kh);
      setTimeout(
        () => flatListRef.current?.scrollToEnd({ animated: true }),
        50,
      );
    };
    const onHide = () => {
      setKeyboardHeight(0);
      log('Keyboard hide');
    };

    const sub1 = Keyboard.addListener(showEvt, onShow);
    const sub2 = Keyboard.addListener(hideEvt, onHide);
    return () => {
      sub1.remove();
      sub2.remove();
    };
  }, []);

  // Load user + household_id
  useEffect(() => {
    const init = async () => {
      try {
        log('Init -> fetching auth user...');
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();
        if (error) log('auth.getUser error:', error);
        if (!user) {
          log('No auth user');
          setLoading(false);
          return;
        }
        setUserId(user.id);
        log('Auth user id:', user.id);

        log('Fetching profile for household_id...');
        const { data: prof, error: pErr } = await supabase
          .from('profiles')
          .select('household_id, current_profile')
          .eq('id', user.id)
          .single();

        if (pErr) log('profiles fetch error:', pErr);
        setHouseholdId(prof?.household_id || null);
        log(
          'Loaded household_id:',
          prof?.household_id,
          'profile:',
          prof?.current_profile,
        );
      } catch (e) {
        log('init exception:', e);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  // Fetch + realtime scoped to household
  useFocusEffect(
    useCallback(() => {
      if (!userId || !householdId) {
        log('Realtime subscribe skipped: missing userId/householdId', {
          userId,
          householdId,
        });
        return;
      }

      let isMounted = true;
      setLoading(true);

      const fetchMessages = async () => {
        log('Fetching messages for household:', householdId);
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('household_id', householdId)
          .order('created_at', { ascending: true });

        if (error) log('Fetch error:', error);
        if (isMounted && data) {
          setMessages(data);
          log('Loaded messages count:', data.length);
          if (data[0]) log('First message row:', data[0]);
        }
        setLoading(false);
      };
      fetchMessages();

      log('Subscribing realtime channel:', `messages-household-${householdId}`);
      const channel = supabase
        .channel(`messages-household-${householdId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'messages',
            filter: `household_id=eq.${householdId}`,
          },
          payload => {
            log('Realtime payload:', payload.eventType, payload.new);
            if (payload?.new) {
              addIfNotPresent(payload.new);
              setTimeout(
                () => flatListRef.current?.scrollToEnd({ animated: true }),
                50,
              );
            }
          },
        )
        .subscribe(status => log('Realtime status:', status));

      return () => {
        supabase.removeChannel(channel);
        log('Unsubscribed channel for household:', householdId);
      };
    }, [userId, householdId, addIfNotPresent]),
  );

  // Invoke edge function to push notifications for a message
  const notifyForMessage = async (messageId, debugNotifySelf = false) => {
    try {
      log(
        'Invoking push-new-message for message_id:',
        messageId,
        'debug:',
        debugNotifySelf,
      );
      const tStart = Date.now();
      const { data: fnRes, error: fnErr } = await supabase.functions.invoke(
        'push-new-message',
        { body: { message_id: messageId, debug_notify_self: debugNotifySelf } },
      );
      const ms = Date.now() - tStart;
      log('push-new-message response:', fnRes, fnErr, 'ms:', ms);
      if (fnRes?.fcmResults) {
        log('FCM Results:', JSON.stringify(fnRes.fcmResults, null, 2));
      }
      if (fnErr) {
        Alert.alert('Push Error', fnErr.message || 'Edge function error');
      }
    } catch (e) {
      log('push-new-message invoke exception:', e);
      Alert.alert('Push Exception', e?.message || String(e));
    }
  };

  // Debug: send push for the latest message in this household (notify myself)
  const debugSendPushForLatestMessage = async () => {
    try {
      if (!householdId) {
        Alert.alert('Debug Push', 'No household found.');
        return;
      }
      log('[Debug] Fetching latest message for household:', householdId);
      const { data, error } = await supabase
        .from('messages')
        .select('id')
        .eq('household_id', householdId)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) {
        log('[Debug] latest message fetch error:', error);
        Alert.alert('Debug Push', error.message);
        return;
      }
      const mid = data?.[0]?.id;
      if (!mid) {
        Alert.alert('Debug Push', 'No messages yet.');
        return;
      }
      await notifyForMessage(mid, true);
    } catch (e) {
      log('[Debug] exception:', e);
      Alert.alert('Debug Push', e?.message || String(e));
    }
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed) {
      log('Send aborted: empty input');
      return;
    }
    if (!userId || !householdId) {
      log('Send aborted: missing userId/householdId', { userId, householdId });
      return;
    }

    log('Sending message:', { userId, householdId, text: trimmed });

    // Optimistic UI
    const tempId = `temp-${Date.now()}`;
    const optimistic = {
      id: tempId,
      sender_id: userId,
      household_id: householdId,
      text: trimmed,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);
    setInput('');
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);

    // Insert
    const { data, error } = await supabase
      .from('messages')
      .insert({ text: trimmed, household_id: householdId, sender_id: userId })
      .select()
      .single();

    if (error) {
      log('Insert error:', error);
      // Rollback optimistic
      setMessages(prev => prev.filter(m => m.id !== tempId));
      Alert.alert('Message Error', error.message || 'Failed to send');
      return;
    }

    log('Insert success:', data);
    upsertMessage(data, tempId);

    // Push notify others (exclude me)
    await notifyForMessage(data.id, false);
  };

  // Group with date separators
  const getMessagesWithSeparators = msgs => {
    if (!msgs.length) return [];
    const result = [];
    let last = '';
    msgs.forEach((msg, idx) => {
      const label = getDateLabel(msg.created_at);
      if (label !== last) {
        result.push({ _id: `sep-${label}-${idx}`, type: 'separator', label });
        last = label;
      }
      result.push({ ...msg, type: 'message' });
    });
    return result;
  };

  const renderItem = ({ item }) => {
    if (item.type === 'separator') {
      return (
        <View style={styles.separatorRow}>
          <Text style={styles.separatorText}>{item.label}</Text>
        </View>
      );
    }
    const isMe = item.sender_id === userId;

    const myBubble = { backgroundColor: theme.colors.primary };
    const partnerBubble = {
      backgroundColor: theme.name === 'pink' ? '#ffe3f2' : '#e3f2fd',
    };

    return (
      <View
        style={[
          styles.messageRow,
          isMe ? styles.messageRowRight : styles.messageRowLeft,
        ]}
      >
        <View
          style={[
            styles.bubble,
            isMe ? myBubble : partnerBubble,
            isMe
              ? { alignSelf: 'flex-end', marginLeft: 40 }
              : { alignSelf: 'flex-start', marginRight: 40 },
          ]}
        >
          <Text
            style={[
              styles.messageText,
              isMe ? { color: '#fff' } : { color: theme.colors.primary },
            ]}
          >
            {item.text}
          </Text>
          <Text
            style={[
              styles.timeTextBubble,
              isMe ? { color: '#f1f5f9' } : { color: '#64748b' },
            ]}
          >
            {item.created_at
              ? new Date(item.created_at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : ''}
          </Text>
        </View>
      </View>
    );
  };

  // Layout offsets
  const androidKbOffset = Platform.OS === 'android' ? keyboardHeight : 0;
  const inputBottom =
    Platform.OS === 'android' ? androidKbOffset : insets.bottom;
  const listBottomPadding = inputBarHeight + androidKbOffset + 16;

  useEffect(() => {
    log(
      'Layout -> keyboardHeight:',
      keyboardHeight,
      'inputBarHeight:',
      inputBarHeight,
      'insets.bottom:',
      insets.bottom,
    );
  }, [keyboardHeight, inputBarHeight, insets.bottom]);

  if (loading) {
    return (
      <SafeAreaView
        style={styles.loader}
        edges={['top', 'bottom', 'left', 'right']}
      >
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.light + '20' }}
      edges={['top', 'left', 'right']}
    >
      {/* Header */}
      <View
        style={[styles.header, { backgroundColor: theme.colors.primary }]}
        onLayout={e => log('Header height:', e.nativeEvent.layout.height)}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Icon name="arrow-back" size={26} color="#fff" />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>I love you</Text>

        {/* Debug push test */}
        <TouchableOpacity
          onPress={debugSendPushForLatestMessage}
          style={styles.backButton}
        >
          <Icon name="notifications" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1 }}>
        <FlatList
          ref={flatListRef}
          data={getMessagesWithSeparators(messages)}
          keyExtractor={item =>
            item.type === 'separator' ? item._id : `msg-${item.id}`
          }
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            padding: 8,
            paddingBottom: listBottomPadding,
          }}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: true })
          }
          ListEmptyComponent={
            <Text style={{ textAlign: 'center', color: '#888', marginTop: 20 }}>
              No messages yet. Say hi! 👋
            </Text>
          }
        />

        {/* Input bar */}
        <View
          style={[
            styles.inputBar,
            {
              backgroundColor: '#fff',
              borderColor: theme.colors.primary + '44',
              bottom: inputBottom + 8,
            },
          ]}
          onLayout={e => {
            const h = e.nativeEvent.layout.height;
            if (h && h !== inputBarHeight) {
              setInputBarHeight(h);
              log('Input bar height measured:', h);
            }
          }}
        >
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Type a message…"
            placeholderTextColor="#aaa"
            style={[
              styles.input,
              {
                color: theme.colors.primary,
                minHeight: MIN_COMPOSER,
                height: Math.min(MAX_COMPOSER, composerHeight),
              },
            ]}
            multiline
            textAlignVertical="top"
            onContentSizeChange={e => {
              const h = e.nativeEvent.contentSize.height;
              const next = Math.max(MIN_COMPOSER, Math.min(MAX_COMPOSER, h));
              if (next !== composerHeight) {
                setComposerHeight(next);
                log('Composer height:', next);
              }
            }}
            scrollEnabled={composerHeight >= MAX_COMPOSER}
          />
          <TouchableOpacity onPress={handleSend} disabled={!input.trim()}>
            <Icon
              name="send"
              size={24}
              color={input.trim() ? theme.colors.primary : '#ccc'}
              style={{ marginHorizontal: 8 }}
            />
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    elevation: 2,
    justifyContent: 'space-between',
  },
  backButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  headerTitle: {
    fontSize: 20,
    color: '#fff',
    fontWeight: 'bold',
    textAlign: 'center',
    flex: 1,
  },

  separatorRow: { alignItems: 'center', marginVertical: 8 },
  separatorText: {
    backgroundColor: '#fff',
    color: '#888',
    fontSize: 13,
    paddingHorizontal: 16,
    paddingVertical: 2,
    borderRadius: 12,
    overflow: 'hidden',
    fontWeight: 'bold',
    opacity: 0.85,
    elevation: 2,
  },

  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 10,
  },
  messageRowLeft: { justifyContent: 'flex-start' },
  messageRowRight: { justifyContent: 'flex-end', alignSelf: 'flex-end' },

  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '99%',
    minWidth: 40,
    marginBottom: 2,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  messageText: { fontSize: 16 },
  timeTextBubble: {
    fontSize: 10,
    alignSelf: 'flex-end',
    marginTop: 4,
    marginLeft: 2,
  },

  inputBar: {
    position: 'absolute',
    left: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: 'transparent',
  },
});

export default PrivateChatScreen;

// import React, { useState, useEffect, useRef, useCallback } from 'react';
// import {
//   View,
//   Text,
//   TextInput,
//   TouchableOpacity,
//   FlatList,
//   StyleSheet,
//   Platform,
//   ActivityIndicator,
//   Keyboard,
// } from 'react-native';
// import {
//   SafeAreaView,
//   useSafeAreaInsets,
// } from 'react-native-safe-area-context';
// import { useFocusEffect } from '@react-navigation/native';
// import { supabase } from '../services/supabase';
// import { useTheme } from '../theme/ThemeContext';
// import Icon from 'react-native-vector-icons/Ionicons';
// import { format, isToday, isYesterday, parseISO } from 'date-fns';

// const log = (...a) => console.log('[Chat]', ...a);

// const getDateLabel = dateStr => {
//   const date = parseISO(dateStr);
//   if (isToday(date)) return 'Today';
//   if (isYesterday(date)) return 'Yesterday';
//   return format(date, 'MMMM d, yyyy');
// };

// const MIN_COMPOSER = 42;
// const MAX_COMPOSER = 140;

// const PrivateChatScreen = ({ navigation }) => {
//   const { theme } = useTheme(); // theme.colors.primary & .light
//   const insets = useSafeAreaInsets();

//   const [messages, setMessages] = useState([]);
//   const [input, setInput] = useState('');
//   const [composerHeight, setComposerHeight] = useState(MIN_COMPOSER);

//   const [userId, setUserId] = useState(null);
//   const [householdId, setHouseholdId] = useState(null);
//   const [loading, setLoading] = useState(true);

//   const [keyboardHeight, setKeyboardHeight] = useState(0);
//   const [inputBarHeight, setInputBarHeight] = useState(56);
//   const flatListRef = useRef();

//   // Helpers for dedupe/merge
//   const upsertMessage = useCallback((msg, replaceId = null) => {
//     setMessages(prev => {
//       const base = replaceId ? prev.filter(m => m.id !== replaceId) : prev;
//       const idx = base.findIndex(m => m.id === msg.id);
//       if (idx !== -1) {
//         const copy = [...base];
//         copy[idx] = { ...copy[idx], ...msg };
//         return copy;
//       }
//       return [...base, msg];
//     });
//   }, []);

//   const addIfNotPresent = useCallback(msg => {
//     setMessages(prev => {
//       const exists = prev.some(m => m.id === msg.id);
//       if (exists)
//         return prev.map(m => (m.id === msg.id ? { ...m, ...msg } : m));
//       return [...prev, msg];
//     });
//   }, []);

//   // Keyboard listeners
//   useEffect(() => {
//     const showEvt =
//       Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
//     const hideEvt =
//       Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

//     const onShow = e => {
//       const kh = e?.endCoordinates?.height || 0;
//       setKeyboardHeight(kh);
//       log('Keyboard show height:', kh);
//       setTimeout(
//         () => flatListRef.current?.scrollToEnd({ animated: true }),
//         50,
//       );
//     };
//     const onHide = () => {
//       setKeyboardHeight(0);
//       log('Keyboard hide');
//     };

//     const sub1 = Keyboard.addListener(showEvt, onShow);
//     const sub2 = Keyboard.addListener(hideEvt, onHide);
//     return () => {
//       sub1.remove();
//       sub2.remove();
//     };
//   }, []);

//   // Load user + household_id
//   useEffect(() => {
//     const init = async () => {
//       try {
//         const {
//           data: { user },
//           error,
//         } = await supabase.auth.getUser();
//         if (error) log('auth.getUser error:', error);
//         if (!user) {
//           log('No auth user');
//           setLoading(false);
//           return;
//         }
//         setUserId(user.id);
//         log('Auth user id:', user.id);

//         // Get household_id (and current_profile if you want local UI hints)
//         const { data: prof, error: pErr } = await supabase
//           .from('profiles')
//           .select('household_id, current_profile')
//           .eq('id', user.id)
//           .single();

//         if (pErr) log('profiles fetch error:', pErr);
//         setHouseholdId(prof?.household_id || null);
//         log(
//           'Loaded household_id:',
//           prof?.household_id,
//           'profile:',
//           prof?.current_profile,
//         );
//       } catch (e) {
//         log('init exception:', e);
//       } finally {
//         setLoading(false);
//       }
//     };
//     init();
//   }, []);

//   // Fetch + realtime scoped to household
//   useFocusEffect(
//     useCallback(() => {
//       if (!userId || !householdId) return;

//       let isMounted = true;
//       setLoading(true);

//       const fetchMessages = async () => {
//         log('Fetching messages for household:', householdId);
//         const { data, error } = await supabase
//           .from('messages')
//           .select('*')
//           .eq('household_id', householdId)
//           .order('created_at', { ascending: true });

//         if (error) log('Fetch error:', error);
//         if (isMounted && data) {
//           setMessages(data);
//           log('Loaded messages count:', data.length);
//           if (data[0]) log('First message row:', data[0]);
//         }
//         setLoading(false);
//       };
//       fetchMessages();

//       const channel = supabase
//         .channel(`messages-household-${householdId}`)
//         .on(
//           'postgres_changes',
//           {
//             event: '*',
//             schema: 'public',
//             table: 'messages',
//             filter: `household_id=eq.${householdId}`,
//           },
//           payload => {
//             log('Realtime payload:', payload.eventType, payload.new);
//             if (payload?.new) {
//               addIfNotPresent(payload.new);
//               setTimeout(
//                 () => flatListRef.current?.scrollToEnd({ animated: true }),
//                 50,
//               );
//             }
//           },
//         )
//         .subscribe(status => log('Realtime status:', status));

//       return () => {
//         supabase.removeChannel(channel);
//         log('Unsubscribed channel for household:', householdId);
//       };
//     }, [userId, householdId, addIfNotPresent]),
//   );

//   const handleSend = async () => {
//     const trimmed = input.trim();
//     if (!trimmed) {
//       log('Send aborted: empty input');
//       return;
//     }
//     if (!userId || !householdId) {
//       log('Send aborted: missing userId/householdId');
//       return;
//     }

//     log('Sending message:', { userId, householdId, text: trimmed });

//     // Optimistic UI
//     const tempId = `temp-${Date.now()}`;
//     const optimistic = {
//       id: tempId,
//       sender_id: userId,
//       household_id: householdId,
//       text: trimmed,
//       created_at: new Date().toISOString(),
//     };
//     setMessages(prev => [...prev, optimistic]);
//     setInput('');
//     setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);

//     // Insert (policies + trigger will ensure household_id & sender_id are correct)
//     const { data, error } = await supabase
//       .from('messages')
//       .insert({ text: trimmed, household_id: householdId, sender_id: userId }) // household_id optional if trigger is set
//       .select()
//       .single();

//     if (error) {
//       log('Insert error:', error);
//       // Rollback optimistic
//       setMessages(prev => prev.filter(m => m.id !== tempId));
//       return;
//     }

//     log('Insert success:', data);
//     upsertMessage(data, tempId);
//   };

//   // Group with date separators
//   const getMessagesWithSeparators = msgs => {
//     if (!msgs.length) return [];
//     const result = [];
//     let last = '';
//     msgs.forEach((msg, idx) => {
//       const label = getDateLabel(msg.created_at);
//       if (label !== last) {
//         result.push({ _id: `sep-${label}-${idx}`, type: 'separator', label });
//         last = label;
//       }
//       result.push({ ...msg, type: 'message' });
//     });
//     return result;
//   };

//   const renderItem = ({ item }) => {
//     if (item.type === 'separator') {
//       return (
//         <View style={styles.separatorRow}>
//           <Text style={styles.separatorText}>{item.label}</Text>
//         </View>
//       );
//     }
//     const isMe = item.sender_id === userId;

//     const myBubble = { backgroundColor: theme.colors.primary };
//     const partnerBubble = {
//       backgroundColor: theme.name === 'pink' ? '#ffe3f2' : '#e3f2fd',
//     };

//     return (
//       <View
//         style={[
//           styles.messageRow,
//           isMe ? styles.messageRowRight : styles.messageRowLeft,
//         ]}
//       >
//         <View
//           style={[
//             styles.bubble,
//             isMe ? myBubble : partnerBubble,
//             isMe
//               ? { alignSelf: 'flex-end', marginLeft: 40 }
//               : { alignSelf: 'flex-start', marginRight: 40 },
//           ]}
//         >
//           <Text
//             style={[
//               styles.messageText,
//               isMe ? { color: '#fff' } : { color: theme.colors.primary },
//             ]}
//           >
//             {item.text}
//           </Text>
//           <Text
//             style={[
//               styles.timeTextBubble,
//               isMe ? { color: '#f1f5f9' } : { color: '#64748b' },
//             ]}
//           >
//             {item.created_at
//               ? new Date(item.created_at).toLocaleTimeString([], {
//                   hour: '2-digit',
//                   minute: '2-digit',
//                 })
//               : ''}
//           </Text>
//         </View>
//       </View>
//     );
//   };

//   // Layout offsets
//   const androidKbOffset = Platform.OS === 'android' ? keyboardHeight : 0;
//   const inputBottom =
//     Platform.OS === 'android' ? androidKbOffset : insets.bottom;
//   const listBottomPadding = inputBarHeight + androidKbOffset + 16;

//   useEffect(() => {
//     log(
//       'Layout -> keyboardHeight:',
//       keyboardHeight,
//       'inputBarHeight:',
//       inputBarHeight,
//       'insets.bottom:',
//       insets.bottom,
//     );
//   }, [keyboardHeight, inputBarHeight, insets.bottom]);

//   if (loading) {
//     return (
//       <SafeAreaView
//         style={styles.loader}
//         edges={['top', 'bottom', 'left', 'right']}
//       >
//         <ActivityIndicator size="large" color={theme.colors.primary} />
//       </SafeAreaView>
//     );
//   }

//   return (
//     <SafeAreaView
//       style={{ flex: 1, backgroundColor: theme.colors.light + '20' }}
//       edges={['top', 'left', 'right']}
//     >
//       {/* Header */}
//       <View
//         style={[styles.header, { backgroundColor: theme.colors.primary }]}
//         onLayout={e => log('Header height:', e.nativeEvent.layout.height)}
//       >
//         <TouchableOpacity
//           onPress={() => navigation.goBack()}
//           style={styles.backButton}
//         >
//           <Icon name="arrow-back" size={26} color="#fff" />
//         </TouchableOpacity>
//         <Text style={styles.headerTitle}>I love you</Text>
//         <View style={{ width: 32 }} />
//       </View>

//       <View style={{ flex: 1 }}>
//         <FlatList
//           ref={flatListRef}
//           data={getMessagesWithSeparators(messages)}
//           keyExtractor={item =>
//             item.type === 'separator' ? item._id : `msg-${item.id}`
//           }
//           renderItem={renderItem}
//           keyboardShouldPersistTaps="handled"
//           contentContainerStyle={{
//             padding: 8,
//             paddingBottom: listBottomPadding,
//           }}
//           onContentSizeChange={() =>
//             flatListRef.current?.scrollToEnd({ animated: true })
//           }
//           ListEmptyComponent={
//             <Text style={{ textAlign: 'center', color: '#888', marginTop: 20 }}>
//               No messages yet. Say hi! 👋
//             </Text>
//           }
//         />

//         {/* Input bar */}
//         <View
//           style={[
//             styles.inputBar,
//             {
//               backgroundColor: '#fff',
//               borderColor: theme.colors.primary + '44',
//               bottom: inputBottom + 8,
//             },
//           ]}
//           onLayout={e => {
//             const h = e.nativeEvent.layout.height;
//             if (h && h !== inputBarHeight) {
//               setInputBarHeight(h);
//               log('Input bar height measured:', h);
//             }
//           }}
//         >
//           <TextInput
//             value={input}
//             onChangeText={setInput}
//             placeholder="Type a message…"
//             placeholderTextColor="#aaa"
//             style={[
//               styles.input,
//               {
//                 color: theme.colors.primary,
//                 minHeight: MIN_COMPOSER,
//                 height: Math.min(MAX_COMPOSER, composerHeight),
//               },
//             ]}
//             multiline
//             textAlignVertical="top"
//             onContentSizeChange={e => {
//               const h = e.nativeEvent.contentSize.height;
//               const next = Math.max(MIN_COMPOSER, Math.min(MAX_COMPOSER, h));
//               if (next !== composerHeight) {
//                 setComposerHeight(next);
//                 log('Composer height:', next);
//               }
//             }}
//             scrollEnabled={composerHeight >= MAX_COMPOSER}
//           />
//           <TouchableOpacity onPress={handleSend} disabled={!input.trim()}>
//             <Icon
//               name="send"
//               size={24}
//               color={input.trim() ? theme.colors.primary : '#ccc'}
//               style={{ marginHorizontal: 8 }}
//             />
//           </TouchableOpacity>
//         </View>
//       </View>
//     </SafeAreaView>
//   );
// };

// const styles = StyleSheet.create({
//   loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },

//   header: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     paddingVertical: 12,
//     paddingHorizontal: 16,
//     borderBottomLeftRadius: 18,
//     borderBottomRightRadius: 18,
//     elevation: 2,
//     justifyContent: 'space-between',
//   },
//   backButton: {
//     width: 32,
//     height: 32,
//     alignItems: 'center',
//     justifyContent: 'center',
//     marginRight: 8,
//   },
//   headerTitle: {
//     fontSize: 20,
//     color: '#fff',
//     fontWeight: 'bold',
//     textAlign: 'center',
//     flex: 1,
//   },

//   separatorRow: { alignItems: 'center', marginVertical: 8 },
//   separatorText: {
//     backgroundColor: '#fff',
//     color: '#888',
//     fontSize: 13,
//     paddingHorizontal: 16,
//     paddingVertical: 2,
//     borderRadius: 12,
//     overflow: 'hidden',
//     fontWeight: 'bold',
//     opacity: 0.85,
//     elevation: 2,
//   },

//   messageRow: {
//     flexDirection: 'row',
//     alignItems: 'flex-end',
//     marginBottom: 10,
//   },
//   messageRowLeft: { justifyContent: 'flex-start' },
//   messageRowRight: { justifyContent: 'flex-end', alignSelf: 'flex-end' },

//   bubble: {
//     borderRadius: 18,
//     paddingHorizontal: 14,
//     paddingVertical: 10,
//     maxWidth: '99%',
//     minWidth: 40,
//     marginBottom: 2,
//     shadowColor: '#000',
//     shadowOpacity: 0.08,
//     shadowRadius: 4,
//     shadowOffset: { width: 0, height: 2 },
//     elevation: 2,
//   },
//   messageText: { fontSize: 16 },
//   timeTextBubble: {
//     fontSize: 10,
//     alignSelf: 'flex-end',
//     marginTop: 4,
//     marginLeft: 2,
//   },

//   inputBar: {
//     position: 'absolute',
//     left: 8,
//     right: 8,
//     flexDirection: 'row',
//     alignItems: 'flex-end',
//     borderRadius: 20,
//     paddingHorizontal: 10,
//     paddingVertical: 6,
//     shadowColor: '#000',
//     shadowOpacity: 0.08,
//     shadowRadius: 6,
//     shadowOffset: { width: 0, height: 2 },
//     elevation: 2,
//     borderWidth: 1,
//   },
//   input: {
//     flex: 1,
//     fontSize: 16,
//     paddingVertical: 6,
//     paddingHorizontal: 8,
//     backgroundColor: 'transparent',
//   },
// });

// export default PrivateChatScreen;
