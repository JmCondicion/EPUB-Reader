import React, { createContext, useContext, useState, useMemo } from 'react';
import { useColorScheme } from 'react-native';

const ThemeContext = createContext(null);

const lightColors = {
  background: '#f5f0e6',
  surface: '#ffffff',
  card: '#eee6d8',
  text: '#111111',
  subtext: '#555555',
  accent: '#3a7bd5',
  border: '#dcd3c2',
  bar: 'rgba(245,240,230,0.95)',
};

const darkColors = {
  background: '#121212',
  surface: '#1a1a1a',
  card: '#1e1e1e',
  text: '#ffffff',
  subtext: '#999999',
  accent: '#4f9cff',
  border: '#2a2a2a',
  bar: 'rgba(20,20,20,0.92)',
};

// Wrap the app in <ThemeProvider> once (in _layout.jsx) so every screen can
// read/set dark mode via useTheme() without prop-drilling or re-deriving it
// per screen.
export function ThemeProvider({ children }) {
  const systemScheme = useColorScheme();
  const [darkMode, setDarkMode] = useState(systemScheme !== 'light');

  const value = useMemo(() => ({
    darkMode,
    toggleDarkMode: () => setDarkMode((d) => !d),
    setDarkMode,
    colors: darkMode ? darkColors : lightColors,
  }), [darkMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
