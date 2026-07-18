import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';

import { initDatabase } from '../../db/database';
import { ThemeProvider, useTheme } from '../../Context/ThemeContext';

function RootLayoutInner() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const { colors, darkMode } = useTheme();

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
      <View
        style={[styles.loading, { backgroundColor: colors.background }]}
        accessible
        accessibilityRole="alert"
        accessibilityLabel={`Failed to load your library: ${String(error.message || error)}`}
      >
        <Text style={{ color: '#ff6b6b', textAlign: 'center', paddingHorizontal: 24 }}>
          Something went wrong loading your library.{'\n'}{String(error.message || error)}
        </Text>
      </View>
    );
  }

  if (!ready) {
    return (
      <View
        style={[styles.loading, { backgroundColor: colors.background }]}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Loading your library"
      >
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'My Library' }} />
      <Stack.Screen name="reader/[bookId]" options={{ title: '', headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <RootLayoutInner />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
