import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { supabase } from '../services/supabase';
import { useTheme } from '../theme/ThemeContext';
import Icon from 'react-native-vector-icons/Ionicons';

const PrivateChatScreen = ({ navigation }) => {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [userId, setUserId] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [loading, setLoading] = useState(true);
  const flatListRef = useRef();

  useEffect(() => {
    const fetchUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUserId(user.id);
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .neq('id', user.id);
      if (data && data.length > 0) setPartnerId(data[0].id);
      setLoading(false);
    };
    fetchUser();
  }, []);

  useEffect(() => {
    if (!userId || !partnerId) return;
    let isMounted = true;
    const fetchMessages = async () => {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .or(
          `and(sender_id.eq.${userId},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${userId})`,
        )
        .order('created_at', { ascending: true });
      if (isMounted && data) setMessages(data);
    };
    fetchMessages();

    const channel = supabase
      .channel('public:messages')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        payload => {
          if (
            (payload.new.sender_id === userId &&
              payload.new.receiver_id === partnerId) ||
            (payload.new.sender_id === partnerId &&
              payload.new.receiver_id === userId)
          ) {
            setMessages(prev => [...prev, payload.new]);
          }
        },
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [userId, partnerId]);

  const handleSend = async () => {
    if (!input.trim()) return;
    setMessages(prev => [
      ...prev,
      {
        id: Date.now(),
        sender_id: userId,
        receiver_id: partnerId,
        text: input.trim(),
        created_at: new Date().toISOString(),
        pending: true,
      },
    ]);
    setInput('');
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
    await supabase.from('messages').insert({
      sender_id: userId,
      receiver_id: partnerId,
      text: input.trim(),
    });
  };

  const renderItem = ({ item }) => {
    const isMe = item.sender_id === userId;
    const myBubble =
      theme.name === 'blue'
        ? { backgroundColor: '#4FC3F7' }
        : { backgroundColor: '#FF80AB' };
    const partnerBubble =
      theme.name === 'blue'
        ? { backgroundColor: '#e3f2fd' }
        : { backgroundColor: '#ffe3f2' };
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
            isMe ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' },
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
        </View>
        <Text style={styles.timeText}>
          {item.created_at &&
            new Date(item.created_at).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
        </Text>
        {isMe && (
          <Icon
            name="checkmark-done"
            size={16}
            color="#fff"
            style={{ marginLeft: 4 }}
          />
        )}
      </View>
    );
  };

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
      style={{
        flex: 1,
        backgroundColor: theme.name === 'blue' ? '#e3f2fd' : '#ffe3f2',
      }}
      edges={['top', 'bottom', 'left', 'right']}
    >
      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.colors.primary }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Icon name="arrow-back" size={26} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>I love you</Text>
        <View style={{ width: 32 }} /> {/* Placeholder for symmetry */}
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={item => item.id.toString()}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 90 }}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: true })
          }
        />
        <View
          style={[
            styles.inputBar,
            {
              backgroundColor: '#fff',
              borderColor: theme.colors.primary + '44',
              marginBottom: 12,
            },
          ]}
        >
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Type a message…"
            placeholderTextColor="#aaa"
            style={[styles.input, { color: theme.colors.primary }]}
            returnKeyType="send"
            onSubmitEditing={handleSend}
          />
          <TouchableOpacity onPress={handleSend} disabled={!input.trim()}>
            <Icon
              name="send"
              size={24}
              color={theme.colors.primary}
              style={{ marginHorizontal: 8 }}
            />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
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
    maxWidth: '75%',
    minWidth: 40,
    marginBottom: 2,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  messageText: { fontSize: 16 },
  timeText: {
    fontSize: 10,
    color: '#888',
    marginLeft: 6,
    marginRight: 6,
    alignSelf: 'flex-end',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    marginHorizontal: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 8,
    paddingHorizontal: 8,
    backgroundColor: 'transparent',
  },
});

export default PrivateChatScreen;
