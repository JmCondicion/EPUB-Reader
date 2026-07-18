import React, { useCallback, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Image, StyleSheet,
  Alert, Pressable,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';

import { addBook, getAllBooks, deleteBook } from '../../db/database';
import { extractEpubMetadata, importEpubFile } from '../../utils/epubUtils';
import { useTheme } from '../theme/ThemeContext';

export default function LibraryScreen() {
  const router = useRouter();
  const { colors, darkMode, toggleDarkMode } = useTheme();
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

  const renderItem = ({ item }) => {
    const percent = Math.round((item.percentage || 0) * 100);
    return (
      <Pressable
        style={styles.card}
        onPress={() => router.push(`/reader/${item.id}`)}
        onLongPress={() => handleDelete(item)}
        accessible
        accessibilityRole="button"
        accessibilityLabel={`${item.title} by ${item.author || 'unknown author'}, ${percent} percent read`}
        accessibilityHint="Opens this book. Long press to remove it from your library."
      >
        {item.cover_path ? (
          <Image source={{ uri: item.cover_path }} style={styles.cover} accessibilityIgnoresInvertColors />
        ) : (
          <View style={[styles.cover, styles.coverPlaceholder, { backgroundColor: colors.card }]}>
            <Text style={[styles.coverPlaceholderText, { color: colors.subtext }]} numberOfLines={4}>
              {item.title}
            </Text>
          </View>
        )}
        <View
          style={[styles.progressTrack, { backgroundColor: colors.border }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <View style={[styles.progressFill, { width: `${percent}%`, backgroundColor: colors.accent }]} />
        </View>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>{item.title}</Text>
        <Text style={[styles.author, { color: colors.subtext }]} numberOfLines={1}>{item.author}</Text>
      </Pressable>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>My Library</Text>
        <TouchableOpacity
          onPress={toggleDarkMode}
          style={[styles.themeToggle, { borderColor: colors.border }]}
          accessible
          accessibilityRole="switch"
          accessibilityState={{ checked: darkMode }}
          accessibilityLabel="Dark mode"
          accessibilityHint="Switches the app between light and dark appearance"
        >
          <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>
            {darkMode ? '🌙 Dark' : '☀️ Light'}
          </Text>
        </TouchableOpacity>
      </View>

      {books.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: colors.text }]}>No books yet.</Text>
          <Text style={[styles.emptySubText, { color: colors.subtext }]}>
            Tap "Import EPUB" to add your first book.
          </Text>
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

      <TouchableOpacity
        style={[styles.fab, { backgroundColor: colors.accent }]}
        onPress={handleImport}
        disabled={importing}
        accessible
        accessibilityRole="button"
        accessibilityLabel={importing ? 'Importing EPUB file' : 'Import EPUB'}
        accessibilityState={{ disabled: importing, busy: importing }}
        accessibilityHint="Opens a file picker to add a new book to your library"
      >
        <Text style={styles.fabText}>{importing ? 'Importing…' : '+ Import EPUB'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4,
  },
  headerTitle: { fontSize: 20, fontWeight: '700' },
  themeToggle: {
    borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6,
  },
  list: { padding: 12 },
  card: { flex: 1 / 3, margin: 6, maxWidth: '31%' },
  cover: { width: '100%', aspectRatio: 2 / 3, borderRadius: 6, backgroundColor: '#333' },
  coverPlaceholder: { alignItems: 'center', justifyContent: 'center', padding: 8 },
  coverPlaceholderText: { fontSize: 12, textAlign: 'center' },
  progressTrack: { height: 3, borderRadius: 2, marginTop: 4 },
  progressFill: { height: 3, borderRadius: 2 },
  title: { fontSize: 12, marginTop: 4, fontWeight: '600' },
  author: { fontSize: 11 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 18, fontWeight: '600' },
  emptySubText: { marginTop: 6 },
  fab: {
    position: 'absolute', bottom: 24, right: 24,
    paddingVertical: 14, paddingHorizontal: 20, borderRadius: 30, elevation: 4,
  },
  fabText: { color: '#fff', fontWeight: '700' },
});
