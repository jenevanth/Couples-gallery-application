import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Animated,
} from 'react-native';
import { supabase } from '../services/supabase';
import Icon from 'react-native-vector-icons/Ionicons';

const FloatingCommentsSection = ({ imageId, userId, theme }) => {
  const [comments, setComments] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [visible, setVisible] = useState(true);
  const flatListRef = useRef();

  // Fetch comments for this image
  useEffect(() => {
    let isMounted = true;
    const fetchComments = async () => {
      const { data, error } = await supabase
        .from('comments')
        .select('*')
        .eq('image_id', imageId)
        .order('created_at', { ascending: true });
      if (isMounted && data) setComments(data);
    };
    fetchComments();

    // Real-time subscription
    const channel = supabase
      .channel('public:comments')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'comments' },
        payload => {
          if (payload.new && payload.new.image_id === imageId) {
            setComments(prev => [...prev, payload.new]);
          }
        },
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [imageId]);

  // Send comment or emoji
  const handleSend = async () => {
    if (!input.trim()) return;
    setSending(true);
    const isEmoji = input.trim().length <= 2 && /\p{Emoji}/u.test(input.trim());
    const { error } = await supabase.from('comments').insert({
      image_id: imageId,
      user_id: userId,
      text: isEmoji ? '' : input.trim(),
      reaction: isEmoji ? input.trim() : null,
    });
    if (!error) setInput('');
    setSending(false);
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  // Render each comment/reaction
  const renderItem = ({ item }) => (
    <View style={styles.commentRow}>
      {item.reaction ? (
        <View style={styles.emojiBubble}>
          <Text style={styles.emojiText}>{item.reaction}</Text>
        </View>
      ) : (
        <View
          style={[
            styles.commentBubble,
            { backgroundColor: theme.colors.primary + '55' },
          ]}
        >
          <Text style={[styles.commentText, { color: '#fff' }]}>
            {item.text}
          </Text>
        </View>
      )}
      <Text style={styles.timeText}>
        {item.created_at &&
          new Date(item.created_at).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
      </Text>
    </View>
  );

  if (!visible) {
    return (
      <TouchableOpacity
        style={styles.fabShow}
        onPress={() => setVisible(true)}
        activeOpacity={0.8}
      >
        <Icon name="chatbubble-ellipses-outline" size={28} color="#fff" />
      </TouchableOpacity>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Animated.View style={styles.floatingContainer}>
        <View style={styles.overlayHeader}>
          <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>
            Comments & Reactions
          </Text>
          <TouchableOpacity onPress={() => setVisible(false)}>
            <Icon name="close" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
        <FlatList
          ref={flatListRef}
          data={comments}
          keyExtractor={item => item.id.toString()}
          renderItem={renderItem}
          style={{ maxHeight: 140 }}
          contentContainerStyle={{ paddingBottom: 4 }}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: true })
          }
        />
        <View style={styles.inputBar}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Add a comment or emoji…"
            placeholderTextColor="#eee"
            style={[styles.input, { color: '#fff' }]}
            returnKeyType="send"
            onSubmitEditing={handleSend}
          />
          <TouchableOpacity
            onPress={handleSend}
            disabled={sending || !input.trim()}
          >
            <Icon
              name="send"
              size={24}
              color="#fff"
              style={{ marginHorizontal: 8 }}
            />
          </TouchableOpacity>
        </View>
      </Animated.View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  floatingContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(30,30,30,0.85)',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    minHeight: 60,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -2 },
    elevation: 8,
  },
  overlayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
    paddingHorizontal: 2,
  },
  commentRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 6,
  },
  emojiBubble: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 18,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginRight: 8,
    minWidth: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiText: { fontSize: 28 },
  commentBubble: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginRight: 8,
    maxWidth: '80%',
  },
  commentText: { fontSize: 16 },
  timeText: { fontSize: 10, color: '#bbb', marginBottom: 2 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 20,
    marginTop: 6,
    marginBottom: 2,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  fabShow: {
    position: 'absolute',
    right: 18,
    bottom: 24,
    backgroundColor: '#222',
    borderRadius: 24,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
});

export default FloatingCommentsSection;
