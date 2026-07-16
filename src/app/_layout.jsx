import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';

import { initDatabase } from '../../db/database';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        await initDatabase();
        setReady(true);
      } catch (err) {
        console.error('initDatabase failed:', err);
        setError(err);
      }
    })();
  }, []);

  if (error) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#ff4f4f" />
      </View>
    );
  }

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#4f9cff" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: '#1a1a1a' }, headerTintColor: '#fff' }}>
      <Stack.Screen name="index" options={{ title: 'My Library' }} />
      <Stack.Screen name="reader/[bookId]" options={{ title: '', headerShown: false }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1a1a' },
});
