import React, { useCallback, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Image, StyleSheet,
  Alert, Pressable,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';

import { addBook, getAllBooks, deleteBook } from '../../db/database';
import { extractEpubMetadata, importEpubFile } from '../../utils/epubUtils';

export default function LibraryScreen() {
  const router = useRouter();
  const [books, setBooks] = useState([]);
  const [importing, setImporting] = useState(false);

  const loadBooks = useCallback(async () => {
    const rows = await getAllBooks();
    setBooks(rows);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadBooks();
    }, [loadBooks])
  );

  const handleImport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/epub+zip', '*/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;

      setImporting(true);
      const file = result.assets[0];
      const localPath = await importEpubFile(file.uri, file.name);
      const meta = await extractEpubMetadata(localPath, Date.now());
      await addBook({
        title: meta.title || file.name,
        author: meta.author,
        filePath: localPath,
        coverPath: meta.coverPath,
      });
      setImporting(false);
      loadBooks();
    } catch (err) {
      setImporting(false);
      Alert.alert('Import failed', String(err.message || err));
    }
  };

  const handleDelete = (book) => {
    Alert.alert('Remove book', `Remove "${book.title}" from your library?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await deleteBook(book.id);
          loadBooks();
        },
      },
    ]);
  };

  const renderItem = ({ item }) => (
    <Pressable
      style={styles.card}
      onPress={() => router.push(`/reader/${item.id}`)}
      onLongPress={() => handleDelete(item)}
    >
      {item.cover_path ? (
        <Image source={{ uri: item.cover_path }} style={styles.cover} />
      ) : (
        <View style={[styles.cover, styles.coverPlaceholder]}>
          <Text style={styles.coverPlaceholderText} numberOfLines={4}>{item.title}</Text>
        </View>
      )}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round((item.percentage || 0) * 100)}%` }]} />
      </View>
      <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
      <Text style={styles.author} numberOfLines={1}>{item.author}</Text>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      {books.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No books yet.</Text>
          <Text style={styles.emptySubText}>Tap "Import EPUB" to add your first book.</Text>
        </View>
      ) : (
        <FlatList
          data={books}
          keyExtractor={(b) => String(b.id)}
          renderItem={renderItem}
          numColumns={3}
          contentContainerStyle={styles.list}
        />
      )}

      <TouchableOpacity style={styles.fab} onPress={handleImport} disabled={importing}>
        <Text style={styles.fabText}>{importing ? 'Importing…' : '+ Import EPUB'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  list: { padding: 12 },
  card: { flex: 1 / 3, margin: 6, maxWidth: '31%' },
  cover: { width: '100%', aspectRatio: 2 / 3, borderRadius: 6, backgroundColor: '#333' },
  coverPlaceholder: { alignItems: 'center', justifyContent: 'center', padding: 8 },
  coverPlaceholderText: { color: '#ccc', fontSize: 12, textAlign: 'center' },
  progressTrack: { height: 3, backgroundColor: '#333', borderRadius: 2, marginTop: 4 },
  progressFill: { height: 3, backgroundColor: '#4f9cff', borderRadius: 2 },
  title: { color: '#fff', fontSize: 12, marginTop: 4, fontWeight: '600' },
  author: { color: '#999', fontSize: 11 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  emptySubText: { color: '#999', marginTop: 6 },
  fab: {
    position: 'absolute', bottom: 24, right: 24, backgroundColor: '#4f9cff',
    paddingVertical: 14, paddingHorizontal: 20, borderRadius: 30, elevation: 4,
  },
  fabText: { color: '#fff', fontWeight: '700' },
});
