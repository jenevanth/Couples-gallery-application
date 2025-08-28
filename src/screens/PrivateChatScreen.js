// screens/PrivateChatScreen.js — fixed for your schema (no display_name/last_seen),
// stable left/right, delivered/read ticks, presence/typing, search, Android keyboard fix

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
  Animated,
  Alert,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import { useTheme } from '../theme/ThemeContext';
import Icon from 'react-native-vector-icons/Ionicons';
import { format, isToday, isYesterday, parseISO } from 'date-fns';
import LinearGradient from 'react-native-linear-gradient';
import Clipboard from '@react-native-clipboard/clipboard';

const log = (...a) => console.log('[Chat]', ...a);
const { width } = Dimensions.get('window');

const getSenderId = m => m?.sender_id ?? m?.user_id ?? null;

const getDateLabel = dateStr => {
  if (!dateStr) return '';
  const d = parseISO(dateStr);
  if (isToday(d)) return '💕 Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'EEEE, MMM d');
};

const getReactionCounts = reactions => {
  if (!reactions) return [];
  const counts = {};
  Object.values(reactions).forEach(e => {
    if (!e) return;
    counts[e] = (counts[e] || 0) + 1;
  });
  return Object.entries(counts).map(([emoji, count]) => ({ emoji, count }));
};

const StatusIcon = ({ me, row }) => {
  if (!me) return null;
  if (row?.seen_at)
    return <Icon name="checkmark-done" size={14} color="#4FC3F7" />;
  if (row?.delivered_at && !row?.seen_at)
    return (
      <Icon name="checkmark-done" size={14} color="rgba(255,255,255,0.85)" />
    );
  if (row?.status === 'sending')
    return <Icon name="time-outline" size={14} color="rgba(255,255,255,0.7)" />;
  return <Icon name="checkmark" size={14} color="rgba(255,255,255,0.75)" />;
};

const QUICK_REACTIONS = ['❤️', '😂', '👍', '😮', '😢', '🔥'];

const PrivateChatScreen = ({ navigation }) => {
  const { theme } = useTheme();
  const primary = theme?.colors?.primary || '#667EEA';
  const secondary = theme?.colors?.secondary || '#764BA2';
  const ultraLight = theme?.colors?.ultraLight || '#F7F7F7';
  const light = theme?.colors?.light || '#F3F4F6';
  const safeGradient =
    Array.isArray(theme?.gradient) &&
    theme.gradient.every(c => typeof c === 'string')
      ? theme.gradient
      : [primary, secondary];

  // Core state
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [userId, setUserId] = useState(null);
  const [householdId, setHouseholdId] = useState(null);
  const [partnerId, setPartnerId] = useState(null);
  const [partnerName, setPartnerName] = useState('Chat');

  // Presence/typing
  const [partnerOnline, setPartnerOnline] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);

  // UI
  const [replyingTo, setReplyingTo] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [showActions, setShowActions] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // Android keyboard
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const flatListRef = useRef();
  const presenceRef = useRef(null);
  const typingRef = useRef(null);
  const typingTimeout = useRef();

  // Animations
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(50)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.spring(slide, {
        toValue: 0,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fade, slide]);

  // Keyboard listeners
  useEffect(() => {
    const showEvt =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, e =>
      setKeyboardHeight(e?.endCoordinates?.height || 0),
    );
    const hide = Keyboard.addListener(hideEvt, () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Init user + household + partner (MATCHES YOUR SCHEMA)
  useEffect(() => {
    const init = async () => {
      log('Init: fetching user...');
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (error || !user) {
        log('Init error/no user:', error);
        setLoading(false);
        return;
      }
      setUserId(user.id);
      log('Init: user id', user.id);

      // profiles has: household_id, name, avatar_url (no display_name or last_seen)
      const { data: me, error: pErr } = await supabase
        .from('profiles')
        .select('household_id, name, avatar_url')
        .eq('id', user.id)
        .single();

      if (pErr) {
        log('Profile fetch error:', pErr?.message);
      } else {
        setHouseholdId(me?.household_id || null);
        log('Init: my household_id =', me?.household_id);
      }

      if (me?.household_id) {
        const { data: partnerRows } = await supabase
          .from('profiles')
          .select('id, name, avatar_url')
          .eq('household_id', me.household_id)
          .neq('id', user.id);

        const partner = partnerRows?.[0];
        if (partner) {
          setPartnerId(partner.id);
          setPartnerName(partner.name || 'Partner');
          log('Init: partner id', partner.id);
        }
      }
      setLoading(false);
    };
    init();
  }, []);

  // Presence + typing
  useEffect(() => {
    if (!userId || !householdId) return;

    const presence = supabase.channel(`presence-${householdId}`, {
      config: { presence: { key: userId } },
    });
    presence.on('presence', { event: 'sync' }, () => {
      const state = presence.presenceState();
      const online = partnerId
        ? Array.isArray(state[partnerId]) && state[partnerId].length > 0
        : false;
      setPartnerOnline(online);
      log('Presence sync online?', online, 'keys:', Object.keys(state));
    });
    presence.subscribe(s => {
      log('Presence status:', s);
      if (s === 'SUBSCRIBED')
        presence.track({ user_id: userId, at: Date.now() });
    });
    presenceRef.current = presence;

    const typing = supabase.channel(`typing-${householdId}`, {
      config: { presence: { key: userId } },
    });
    typing.on('presence', { event: 'sync' }, () => {
      let partnerIsTyping = false;
      const state = typing.presenceState();
      Object.entries(state).forEach(([key, presences]) => {
        if (key !== String(userId))
          partnerIsTyping = presences.some(p => p.is_typing);
      });
      setPartnerTyping(partnerIsTyping);
    });
    typing.subscribe(s => {
      log('Typing status:', s);
      if (s === 'SUBSCRIBED')
        typing.track({ user_id: userId, is_typing: false });
    });
    typingRef.current = typing;

    return () => {
      if (presenceRef.current) supabase.removeChannel(presenceRef.current);
      if (typingRef.current) supabase.removeChannel(typingRef.current);
    };
  }, [userId, householdId, partnerId]);

  const handleInputChange = text => {
    setInput(text);
    if (!typingRef.current) return;
    if (text.length > 0) {
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      typingRef.current.track({ user_id: userId, is_typing: true });
      typingTimeout.current = setTimeout(
        () => typingRef.current?.track({ user_id: userId, is_typing: false }),
        1200,
      );
    } else {
      typingRef.current.track({ user_id: userId, is_typing: false });
    }
  };

  // Delivered + Seen
  const markDelivered = useCallback(
    async msg => {
      try {
        if (!msg?.id) return;
        const fromId = getSenderId(msg);
        if (!fromId || fromId === userId || msg.delivered_at) return;
        const { error } = await supabase
          .from('messages')
          .update({
            delivered_at: new Date().toISOString(),
            status: 'delivered',
          })
          .eq('id', msg.id);
        if (error) log('markDelivered error:', error.message);
        else log('Delivered ->', msg.id);
      } catch (e) {
        log('markDelivered exception:', e);
      }
    },
    [userId],
  );

  const markSeen = useCallback(
    async msgs => {
      try {
        const ids = (msgs || [])
          .filter(m => getSenderId(m) !== userId && !m.seen_at)
          .map(m => m.id);
        if (ids.length === 0) return;
        const { error } = await supabase
          .from('messages')
          .update({ seen_at: new Date().toISOString(), status: 'seen' })
          .in('id', ids);
        if (error) log('markSeen error:', error.message);
        else log('Seen ->', ids);
      } catch (e) {
        log('markSeen exception:', e);
      }
    },
    [userId],
  );

  // Fetch + realtime
  useFocusEffect(
    useCallback(() => {
      if (!userId || !householdId) {
        log('Skip subscribe: missing userId/householdId', {
          userId,
          householdId,
        });
        return;
      }

      let mounted = true;
      setLoading(true);

      const fetchMessages = async () => {
        log('Fetching messages household:', householdId);
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('household_id', householdId)
          .order('created_at', { ascending: true });

        if (error) log('Fetch error:', error.message);
        if (mounted && data) {
          setMessages(data);
          log('Fetched count:', data.length);
          markSeen(data); // chat visible
          setTimeout(
            () => flatListRef.current?.scrollToEnd({ animated: false }),
            60,
          );
        }
        setLoading(false);
      };
      fetchMessages();

      const channel = supabase
        .channel(`messages-${householdId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'messages',
            filter: `household_id=eq.${householdId}`,
          },
          async payload => {
            log(
              'Realtime:',
              payload.eventType,
              payload.new?.id || payload.old?.id,
            );
            if (payload.eventType === 'INSERT' && payload.new) {
              const fromId = getSenderId(payload.new);
              setMessages(prev =>
                prev.some(m => m.id === payload.new.id)
                  ? prev
                  : [...prev, payload.new],
              );
              if (fromId && fromId !== userId) {
                await markDelivered(payload.new);
                await markSeen([payload.new]);
              }
              setTimeout(
                () => flatListRef.current?.scrollToEnd({ animated: true }),
                50,
              );
            } else if (payload.eventType === 'UPDATE' && payload.new) {
              setMessages(prev =>
                prev.map(m =>
                  m.id === payload.new.id ? { ...m, ...payload.new } : m,
                ),
              );
            } else if (payload.eventType === 'DELETE' && payload.old) {
              setMessages(prev => prev.filter(m => m.id !== payload.old.id));
            }
          },
        )
        .subscribe(s => log('Messages channel status:', s));

      return () => {
        mounted = false;
        supabase.removeChannel(channel);
      };
    }, [userId, householdId, markDelivered, markSeen]),
  );

  const ready = Boolean(userId && householdId);

  // Send
  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;
    if (!ready) {
      Alert.alert('Please wait', 'Initializing chat, try again in a moment.');
      return;
    }

    const tempId = `temp-${Date.now()}`;
    const optimistic = {
      id: tempId,
      text,
      sender_id: userId,
      user_id: userId,
      household_id: householdId,
      created_at: new Date().toISOString(),
      status: 'sending',
      reply_to: replyingTo?.id || null,
      reply_to_text: replyingTo?.text || null,
    };
    setMessages(prev => [...prev, optimistic]);
    setInput('');
    setReplyingTo(null);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 40);

    const { data, error } = await supabase
      .from('messages')
      .insert({
        text,
        sender_id: userId,
        user_id: userId,
        household_id: householdId,
        status: 'sent',
        reply_to: replyingTo?.id || null,
        reply_to_text: replyingTo?.text || null,
      })
      .select()
      .single();

    if (error) {
      log('Insert error:', error.message);
      setMessages(prev => prev.filter(m => m.id !== tempId));
      Alert.alert('Message Error', error.message || 'Failed to send');
      return;
    }

    setMessages(prev => prev.map(m => (m.id === tempId ? data : m)));
    log('Message sent:', data.id);

    try {
      await supabase.functions.invoke('push-new-message', {
        body: { message_id: data.id, text: data.text },
      });
    } catch (e) {
      log('Notify error:', e?.message || String(e));
    }
  };

  // Edit / Delete / Copy / Reactions
  const handleEdit = async msg => {
    const text = input.trim();
    if (!text) return;
    const { error } = await supabase
      .from('messages')
      .update({ text, edited: true, edited_at: new Date().toISOString() })
      .eq('id', msg.id);
    if (error) {
      Alert.alert('Edit error', error.message);
      return;
    }
    setMessages(prev =>
      prev.map(m =>
        m.id === msg.id
          ? { ...m, text, edited: true, edited_at: new Date().toISOString() }
          : m,
      ),
    );
    setEditingMessage(null);
    setInput('');
  };

  const handleDelete = message => {
    Alert.alert('Delete Message', 'Delete for everyone?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('messages').delete().eq('id', message.id);
        },
      },
    ]);
  };

  const handleCopy = txt => {
    Clipboard.setString(txt || '');
    Alert.alert('Copied', 'Message copied to clipboard');
  };

  const toggleReaction = async (messageId, emoji) => {
    const m = messages.find(x => x.id === messageId);
    if (!m) return;
    const reactions = { ...(m.reactions || {}) };
    if (reactions[userId] === emoji) delete reactions[userId];
    else reactions[userId] = emoji;
    setMessages(prev =>
      prev.map(x => (x.id === messageId ? { ...x, reactions } : x)),
    );
    const { error } = await supabase
      .from('messages')
      .update({ reactions })
      .eq('id', messageId);
    if (error) log('Reaction update error:', error.message);
    setShowReactions(false);
    setSelectedMessage(null);
  };

  // Search + grouping
  const filtered = () => {
    if (!searchQuery) return messages;
    const q = searchQuery.toLowerCase();
    return messages.filter(m => (m.text || '').toLowerCase().includes(q));
  };

  const grouped = () => {
    const out = [];
    let last = '';
    filtered().forEach((m, idx) => {
      const label = getDateLabel(m.created_at);
      if (label && label !== last) {
        out.push({ type: 'date', id: `sep-${label}-${idx}`, date: label });
        last = label;
      }
      out.push({ type: 'message', ...m });
    });
    return out;
  };

  const statusText = () => {
    if (partnerTyping) return 'typing...';
    return partnerOnline ? 'online' : 'offline';
  };

  const renderItem = ({ item }) => {
    if (item.type === 'date') {
      return (
        <View style={styles.dateRow}>
          <LinearGradient colors={[light, ultraLight]} style={styles.dateBadge}>
            <Text style={[styles.dateText, { color: primary }]}>
              {item.date}
            </Text>
          </LinearGradient>
        </View>
      );
    }
    const isMe = getSenderId(item) === userId;
    const time = item.created_at
      ? format(parseISO(item.created_at), 'h:mm a')
      : '';
    const counts = getReactionCounts(item.reactions);

    return (
      <View style={[styles.msgRow, isMe ? styles.msgRight : styles.msgLeft]}>
        <Pressable
          onLongPress={() => {
            setSelectedMessage(item);
            setShowActions(true);
          }}
          delayLongPress={300}
        >
          <LinearGradient
            colors={isMe ? safeGradient : ['#F0F0F0', '#E8E8E8']}
            style={[styles.bubble, isMe ? styles.myBubble : styles.theirBubble]}
          >
            {item.reply_to_text ? (
              <View
                style={[
                  styles.replyStrip,
                  { borderColor: isMe ? 'rgba(255,255,255,0.5)' : '#ddd' },
                ]}
              >
                <View
                  style={[
                    styles.replyBar,
                    {
                      backgroundColor: isMe ? 'rgba(255,255,255,0.6)' : '#aaa',
                    },
                  ]}
                />
                <Text
                  style={[styles.replyText, { color: isMe ? '#fff' : '#555' }]}
                  numberOfLines={1}
                >
                  {item.reply_to_text}
                </Text>
              </View>
            ) : null}

            <Text style={[styles.msgText, { color: isMe ? '#fff' : '#333' }]}>
              {item.text}
            </Text>

            <View style={styles.footerRow}>
              <Text
                style={[
                  styles.timeText,
                  { color: isMe ? 'rgba(255,255,255,0.85)' : '#888' },
                ]}
              >
                {time}
              </Text>
              {item.edited ? (
                <Text
                  style={[
                    styles.editedText,
                    { color: isMe ? 'rgba(255,255,255,0.8)' : '#999' },
                  ]}
                >
                  edited
                </Text>
              ) : null}
              <View style={{ marginLeft: 6 }}>
                <StatusIcon me={isMe} row={item} />
              </View>
            </View>

            {counts.length > 0 && (
              <View
                style={[styles.reactionsBar, isMe ? { right: 8 } : { left: 8 }]}
              >
                {counts.map(({ emoji, count }) => (
                  <View key={emoji} style={styles.reactionChip}>
                    <Text style={styles.reactionTxt}>
                      {emoji}
                      {count > 1 ? ` ${count}` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </LinearGradient>
        </Pressable>
      </View>
    );
  };

  if (loading) {
    return (
      <LinearGradient colors={safeGradient} style={styles.loader}>
        <ActivityIndicator size="large" color="#fff" />
        <Text style={styles.loadingText}>Loading messages...</Text>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={[ultraLight, '#fff']} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }}>
        {/* Header */}
        <LinearGradient colors={safeGradient} style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
          >
            <Icon name="arrow-back" size={26} color="#fff" />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>{partnerName} 💕</Text>
            <View style={styles.statusRow}>
              {partnerOnline && <View style={styles.onlineDot} />}
              <Text style={styles.statusTxt}>{statusText()}</Text>
            </View>
          </View>

          <TouchableOpacity
            onPress={() => setSearchVisible(v => !v)}
            style={styles.headerBtn}
          >
            <Icon name="search" size={22} color="#fff" />
          </TouchableOpacity>
        </LinearGradient>

        {/* Search */}
        {searchVisible && (
          <Animated.View
            style={[
              styles.searchBar,
              { opacity: fade, transform: [{ translateY: slide }] },
            ]}
          >
            <Icon name="search" size={18} color={primary} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search messages…"
              placeholderTextColor="#999"
              style={styles.searchInput}
              autoFocus
            />
            <TouchableOpacity
              onPress={() => {
                setSearchQuery('');
                setSearchVisible(false);
              }}
            >
              <Icon name="close" size={22} color={primary} />
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* Messages list */}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
        >
          <FlatList
            ref={flatListRef}
            data={grouped()}
            keyExtractor={(it, idx) => (it.id ? String(it.id) : `row-${idx}`)}
            renderItem={renderItem}
            contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
            onContentSizeChange={() =>
              setTimeout(
                () => flatListRef.current?.scrollToEnd({ animated: false }),
                50,
              )
            }
            onScrollBeginDrag={() => markSeen(messages)}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Icon name="chatbubbles-outline" size={60} color={primary} />
                <Text style={[styles.emptyTxt, { color: primary }]}>
                  {searchQuery ? 'No messages found' : 'No messages yet'}
                </Text>
              </View>
            }
          />

          {/* Reply preview */}
          {replyingTo && (
            <View style={styles.replyPreview}>
              <Icon name="return-down-forward" size={20} color={primary} />
              <View style={{ flex: 1, marginHorizontal: 8 }}>
                <Text
                  style={{ fontSize: 12, color: '#666', fontWeight: '600' }}
                >
                  Replying to
                </Text>
                <Text numberOfLines={1} style={{ fontSize: 14, color: '#333' }}>
                  {replyingTo.text}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setReplyingTo(null)}>
                <Icon name="close-circle" size={22} color="#999" />
              </TouchableOpacity>
            </View>
          )}

          {/* Input bar (Android keyboard fix: marginBottom) */}
          <View
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              marginBottom: Platform.OS === 'android' ? keyboardHeight : 0,
            }}
          >
            <LinearGradient
              colors={['#fff', ultraLight]}
              style={styles.inputBar}
            >
              <TouchableOpacity
                onPress={() => setShowAttachMenu(true)}
                style={styles.iconBtn}
              >
                <Icon name="add-circle" size={28} color={primary} />
              </TouchableOpacity>

              <TextInput
                value={input}
                onChangeText={handleInputChange}
                placeholder={
                  editingMessage ? 'Edit message...' : 'Type a message...'
                }
                placeholderTextColor="#888"
                style={styles.input}
                multiline
                maxHeight={120}
              />

              <TouchableOpacity
                onPress={
                  editingMessage ? () => handleEdit(editingMessage) : handleSend
                }
                disabled={!input.trim() || !ready}
                style={styles.sendBtn}
              >
                <LinearGradient
                  colors={
                    input.trim() && ready
                      ? safeGradient
                      : ['#E0E0E0', '#D0D0D0']
                  }
                  style={styles.sendBtnGrad}
                >
                  <Icon name="send" size={20} color="#fff" />
                </LinearGradient>
              </TouchableOpacity>
            </LinearGradient>
          </View>
        </KeyboardAvoidingView>

        {/* Actions */}
        <Modal
          visible={showActions}
          transparent
          animationType="fade"
          onRequestClose={() => setShowActions(false)}
        >
          <Pressable
            style={styles.modalOverlay}
            onPress={() => setShowActions(false)}
          >
            <View style={styles.actionsBox}>
              <TouchableOpacity
                style={styles.actRow}
                onPress={() => {
                  setReplyingTo(selectedMessage);
                  setShowActions(false);
                }}
              >
                <Icon name="arrow-undo" size={20} color={primary} />
                <Text style={styles.actTxt}>Reply</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actRow}
                onPress={() => {
                  handleCopy(selectedMessage?.text || '');
                  setShowActions(false);
                }}
              >
                <Icon name="copy" size={20} color={primary} />
                <Text style={styles.actTxt}>Copy</Text>
              </TouchableOpacity>

              {getSenderId(selectedMessage) === userId && (
                <>
                  <TouchableOpacity
                    style={styles.actRow}
                    onPress={() => {
                      setEditingMessage(selectedMessage);
                      setInput(selectedMessage.text);
                      setShowActions(false);
                    }}
                  >
                    <Icon name="create" size={20} color={primary} />
                    <Text style={styles.actTxt}>Edit</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.actRow}
                    onPress={() => {
                      handleDelete(selectedMessage);
                      setShowActions(false);
                    }}
                  >
                    <Icon name="trash" size={20} color="#E63946" />
                    <Text style={[styles.actTxt, { color: '#E63946' }]}>
                      Delete
                    </Text>
                  </TouchableOpacity>
                </>
              )}

              <TouchableOpacity
                style={styles.actRow}
                onPress={() => {
                  setShowReactions(true);
                  setShowActions(false);
                }}
              >
                <Icon name="happy" size={20} color={primary} />
                <Text style={styles.actTxt}>React</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Modal>

        {/* Reactions modal */}
        <Modal
          visible={showReactions}
          transparent
          animationType="slide"
          onRequestClose={() => setShowReactions(false)}
        >
          <Pressable
            style={styles.modalOverlay}
            onPress={() => setShowReactions(false)}
          >
            <View style={styles.reactionsBox}>
              {QUICK_REACTIONS.map(emoji => (
                <TouchableOpacity
                  key={emoji}
                  style={styles.reactionBtn}
                  onPress={() => toggleReaction(selectedMessage?.id, emoji)}
                >
                  <Text style={{ fontSize: 28 }}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Pressable>
        </Modal>

        {/* Attachment (placeholders) */}
        <Modal
          visible={showAttachMenu}
          transparent
          animationType="slide"
          onRequestClose={() => setShowAttachMenu(false)}
        >
          <Pressable
            style={styles.modalOverlay}
            onPress={() => setShowAttachMenu(false)}
          >
            <View style={styles.attachBox}>
              <TouchableOpacity
                style={styles.attachItem}
                onPress={() => {
                  Alert.alert('Coming soon', 'Photo sharing soon');
                  setShowAttachMenu(false);
                }}
              >
                <LinearGradient
                  colors={['#FF6B9D', '#FE8C00']}
                  style={styles.attachIcon}
                >
                  <Icon name="image" size={24} color="#fff" />
                </LinearGradient>
                <Text style={styles.attachTxt}>Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.attachItem}
                onPress={() => {
                  Alert.alert('Coming soon', 'Video soon');
                  setShowAttachMenu(false);
                }}
              >
                <LinearGradient
                  colors={['#667EEA', '#764BA2']}
                  style={styles.attachIcon}
                >
                  <Icon name="videocam" size={24} color="#fff" />
                </LinearGradient>
                <Text style={styles.attachTxt}>Video</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.attachItem}
                onPress={() => {
                  Alert.alert('Coming soon', 'Location soon');
                  setShowAttachMenu(false);
                }}
              >
                <LinearGradient
                  colors={['#06FFA5', '#00D4FF']}
                  style={styles.attachIcon}
                >
                  <Icon name="location" size={24} color="#fff" />
                </LinearGradient>
                <Text style={styles.attachTxt}>Location</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.attachItem}
                onPress={() => {
                  Alert.alert('Coming soon', 'Voice soon');
                  setShowAttachMenu(false);
                }}
              >
                <LinearGradient
                  colors={['#FFD60A', '#FFA500']}
                  style={styles.attachIcon}
                >
                  <Icon name="mic" size={24} color="#fff" />
                </LinearGradient>
                <Text style={styles.attachTxt}>Voice</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Modal>
      </SafeAreaView>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#fff', marginTop: 12 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    elevation: 4,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, marginLeft: 8 },
  headerTitle: { fontSize: 20, color: '#fff', fontWeight: 'bold' },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00E676',
    marginRight: 6,
  },
  statusTxt: { fontSize: 12, color: 'rgba(255,255,255,0.85)' },
  headerBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  searchInput: { flex: 1, fontSize: 16, marginHorizontal: 8, color: '#333' },

  dateRow: { alignItems: 'center', marginVertical: 14 },
  dateBadge: { paddingHorizontal: 18, paddingVertical: 6, borderRadius: 16 },
  dateText: { fontSize: 12, fontWeight: '600' },

  msgRow: { marginBottom: 8, paddingHorizontal: 6 },
  msgRight: { alignItems: 'flex-end' },
  msgLeft: { alignItems: 'flex-start' },

  bubble: {
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxWidth: width * 0.75,
    minWidth: 60,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  myBubble: { borderBottomRightRadius: 4 },
  theirBubble: { borderBottomLeftRadius: 4 },

  replyStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    marginBottom: 8,
    paddingBottom: 6,
  },
  replyBar: { width: 3, height: 16, borderRadius: 2, marginRight: 8 },
  replyText: { fontSize: 12, fontStyle: 'italic', flex: 1 },

  msgText: { fontSize: 16, lineHeight: 22 },
  footerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  timeText: { fontSize: 11, marginRight: 6 },
  editedText: { fontSize: 11, fontStyle: 'italic' },

  reactionsBar: { position: 'absolute', bottom: -12, flexDirection: 'row' },
  reactionChip: {
    backgroundColor: 'rgba(0,0,0,0.06)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 4,
  },
  reactionTxt: { fontSize: 12, color: '#444' },

  empty: { alignItems: 'center', marginTop: 100 },
  emptyTxt: { fontSize: 20, fontWeight: 'bold', marginTop: 12 },

  replyPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: 25,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    elevation: 3,
  },
  iconBtn: { padding: 4 },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 8,
    paddingHorizontal: 10,
    color: '#333',
  },
  sendBtn: { padding: 4, marginLeft: 6 },
  sendBtnGrad: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionsBox: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 8,
    width: width * 0.8,
    elevation: 8,
  },
  actRow: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  actTxt: { marginLeft: 12, fontSize: 16, color: '#333' },

  reactionsBox: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 30,
    padding: 12,
    elevation: 8,
  },
  reactionBtn: { padding: 8, marginHorizontal: 4 },

  attachBox: {
    position: 'absolute',
    bottom: 100,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: width - 40,
    alignSelf: 'center',
  },
  attachItem: { alignItems: 'center', width: '25%', marginBottom: 16 },
  attachIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  attachTxt: { fontSize: 12, color: '#666' },
});

export default PrivateChatScreen;

// // src/screens/PrivateChatScreen.js
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
//   Alert,
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
//   const { theme } = useTheme();
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
//         log('Init -> fetching auth user...');
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

//         log('Fetching profile for household_id...');
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
//       if (!userId || !householdId) {
//         log('Realtime subscribe skipped: missing userId/householdId', {
//           userId,
//           householdId,
//         });
//         return;
//       }

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

//       log('Subscribing realtime channel:', `messages-household-${householdId}`);
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

//   // Invoke edge function to push notifications for a message
//   const notifyForMessage = async (messageId, debugNotifySelf = false) => {
//     try {
//       log(
//         'Invoking push-new-message for message_id:',
//         messageId,
//         'debug:',
//         debugNotifySelf,
//       );
//       const tStart = Date.now();
//       const { data: fnRes, error: fnErr } = await supabase.functions.invoke(
//         'push-new-message',
//         { body: { message_id: messageId, debug_notify_self: debugNotifySelf } },
//       );
//       const ms = Date.now() - tStart;
//       log('push-new-message response:', fnRes, fnErr, 'ms:', ms);
//       if (fnRes?.fcmResults) {
//         log('FCM Results:', JSON.stringify(fnRes.fcmResults, null, 2));
//       }
//       if (fnErr) {
//         Alert.alert('Push Error', fnErr.message || 'Edge function error');
//       }
//     } catch (e) {
//       log('push-new-message invoke exception:', e);
//       Alert.alert('Push Exception', e?.message || String(e));
//     }
//   };

//   // Debug: send push for the latest message in this household (notify myself)
//   const debugSendPushForLatestMessage = async () => {
//     try {
//       if (!householdId) {
//         Alert.alert('Debug Push', 'No household found.');
//         return;
//       }
//       log('[Debug] Fetching latest message for household:', householdId);
//       const { data, error } = await supabase
//         .from('messages')
//         .select('id')
//         .eq('household_id', householdId)
//         .order('created_at', { ascending: false })
//         .limit(1);
//       if (error) {
//         log('[Debug] latest message fetch error:', error);
//         Alert.alert('Debug Push', error.message);
//         return;
//       }
//       const mid = data?.[0]?.id;
//       if (!mid) {
//         Alert.alert('Debug Push', 'No messages yet.');
//         return;
//       }
//       await notifyForMessage(mid, true);
//     } catch (e) {
//       log('[Debug] exception:', e);
//       Alert.alert('Debug Push', e?.message || String(e));
//     }
//   };

//   const handleSend = async () => {
//     const trimmed = input.trim();
//     if (!trimmed) {
//       log('Send aborted: empty input');
//       return;
//     }
//     if (!userId || !householdId) {
//       log('Send aborted: missing userId/householdId', { userId, householdId });
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

//     // Insert
//     const { data, error } = await supabase
//       .from('messages')
//       .insert({ text: trimmed, household_id: householdId, sender_id: userId })
//       .select()
//       .single();

//     if (error) {
//       log('Insert error:', error);
//       // Rollback optimistic
//       setMessages(prev => prev.filter(m => m.id !== tempId));
//       Alert.alert('Message Error', error.message || 'Failed to send');
//       return;
//     }

//     log('Insert success:', data);
//     upsertMessage(data, tempId);

//     // Push notify others (exclude me)
//     await notifyForMessage(data.id, false);
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

//         {/* Debug push test */}
//         <TouchableOpacity
//           onPress={debugSendPushForLatestMessage}
//           style={styles.backButton}
//         >
//           <Icon name="notifications" size={22} color="#fff" />
//         </TouchableOpacity>
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
