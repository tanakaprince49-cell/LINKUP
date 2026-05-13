import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, SafeAreaView, KeyboardAvoidingView, Platform } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { db } from '../lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { X, Code } from 'lucide-react-native';

export default function CreatePostScreen({ navigation }: any) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [content, setContent] = useState('');
  const [isPosting, setIsPosting] = useState(false);

  const handlePost = async () => {
    if (!content.trim() || !user || isPosting) return;
    
    setIsPosting(true);
    try {
      await addDoc(collection(db, 'posts'), {
        authorId: user.uid,
        authorName: user.displayName || 'Builder',
        content,
        type: 'build',
        timestamp: serverTimestamp(),
        likesCount: 0,
        commentsCount: 0,
        likedBy: []
      });
      navigation.goBack();
    } catch (err) {
      console.error("Failed to post:", err);
      setIsPosting(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#121212' : '#FFFFFF' }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeBtn}>
            <X size={24} color={isDark ? '#FFFFFF' : '#000000'} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: isDark ? '#FFFFFF' : '#000000' }]}>SHIP SOMETHING</Text>
          <TouchableOpacity onPress={handlePost} disabled={!content.trim() || isPosting}>
            <Text style={[styles.postBtn, { opacity: content.trim() ? 1 : 0.5 }]}>
              {isPosting ? '...' : 'PUBLISH'}
            </Text>
          </TouchableOpacity>
        </View>
        
        <TextInput
          autoFocus
          multiline
          placeholder="What did you ship today? Paste a link or describe your progress..."
          placeholderTextColor={isDark ? '#888888' : '#AAAAAA'}
          style={[styles.input, { color: isDark ? '#FFFFFF' : '#000000' }]}
          value={content}
          onChangeText={setContent}
        />
        
        <View style={styles.powTip}>
          <Code size={16} color="#FBE618" />
          <Text style={styles.powTipText}>Proof of Work increases your visibility.</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  closeBtn: {
    padding: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1,
  },
  postBtn: {
    color: '#FBE618',
    fontWeight: '900',
    fontSize: 16,
  },
  input: {
    flex: 1,
    padding: 20,
    fontSize: 18,
    textAlignVertical: 'top',
  },
  powTip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 20,
    backgroundColor: '#FBE61815',
    margin: 20,
    borderRadius: 20,
  },
  powTipText: {
    color: '#FBE618',
    fontSize: 13,
    fontWeight: '700',
  },
});
