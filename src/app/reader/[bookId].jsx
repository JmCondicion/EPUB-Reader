import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, SafeAreaView, ScrollView } from 'react-native';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system';
import * as Speech from 'expo-speech';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { saveProgress, getProgress, touchBook, addBookmark, getBook } from '../../../db/database';
import { useTheme } from '../../theme/ThemeContext';

// epub.js loaded from CDN inside the WebView's HTML shell.
const READER_HTML = (base64Epub, startCfi, darkMode) => `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js"></script>
  <style>
    html, body { margin:0; padding:0; height:100%; background:${darkMode ? '#1a1a1a' : '#f5f0e6'}; }
    #viewer { width:100vw; height:100vh; }
  </style>
</head>
<body>
  <div id="viewer"></div>
  <script>
    function base64ToArrayBuffer(base64) {
      const binary = atob(base64);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
      return bytes.buffer;
    }

    const bookData = base64ToArrayBuffer("${base64Epub}");
    const book = ePub(bookData);
    const rendition = book.renderTo("viewer", {
      width: "100%",
      height: "100%",
      spread: "none"
    });

    const startCfi = ${startCfi ? `"${startCfi}"` : 'null'};
    rendition.display(startCfi || undefined);

    // Apply initial theme immediately so it matches the app shell instead
    // of flashing light before the first 'setTheme' message arrives.
    rendition.themes.override('color', ${darkMode ? "'#ddd'" : "'#111'"});
    rendition.themes.override('background', ${darkMode ? "'#1a1a1a'" : "'#f5f0e6'"});

    rendition.on('relocated', (location) => {
      const percentage = book.locations.length() ? book.locations.percentageFromCfi(location.start.cfi) : 0;
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'progress',
        cfi: location.start.cfi,
        percentage: percentage || 0
      }));
    });

    book.ready.then(() => book.locations.generate(1000)).then(() => {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
    });

    // Send the table of contents so React Native can build an audiobook
    // chapter sequence (also used for chapter navigation).
    book.loaded.navigation.then((nav) => {
      const flatten = (items) => items.map((i) => ({ href: i.href, label: (i.label || '').trim() }));
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'chapters', chapters: flatten(nav.toc) }));
    });

    document.addEventListener('touchstart', function(e) {
      const x = e.touches[0].clientX;
      const width = window.innerWidth;
      if (x < width * 0.3) rendition.prev();
      else if (x > width * 0.7) rendition.next();
    });

    window.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'getCfi') {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'currentCfi', cfi: rendition.currentLocation().start.cfi }));
        }
        if (msg.type === 'setFontSize') {
          rendition.themes.fontSize(msg.size + '%');
        }
        if (msg.type === 'displayHref') {
          rendition.display(msg.href);
        }
        if (msg.type === 'getChapterText') {
          const section = book.spine.get(msg.href);
          if (!section) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'chapterText', href: msg.href, text: '' }));
          } else {
            section.load(book.load.bind(book)).then(() => {
              const text = (section.document.body.innerText || section.document.body.textContent || '').trim();
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'chapterText', href: msg.href, text }));
              section.unload();
            }).catch(() => {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'chapterText', href: msg.href, text: '' }));
            });
          }
        }
        if (msg.type === 'setTheme') {
          if (msg.theme === 'dark') {
            document.body.style.background = '#1a1a1a';
            rendition.themes.override('color', '#ddd');
            rendition.themes.override('background', '#1a1a1a');
          } else {
            document.body.style.background = '#f5f0e6';
            rendition.themes.override('color', '#111');
            rendition.themes.override('background', '#f5f0e6');
          }
        }
        if (msg.type === 'setFontScale') {
          rendition.themes.fontSize(msg.scale + '%');
        }
      } catch (e) {}
    });
  </script>
</body>
</html>
`;

export default function ReaderScreen() {
  const { bookId } = useLocalSearchParams();
  const router = useRouter();
  const { colors, darkMode, toggleDarkMode } = useTheme();
  const webviewRef = useRef(null);
  const [html, setHtml] = useState(null);
  const [title, setTitle] = useState('');
  const [controlsVisible, setControlsVisible] = useState(false);
  const [fontScale, setFontScale] = useState(100); // percent, for low-vision accessibility

  // ---- Audiobook (text-to-speech) state ----
  const [audiobookMode, setAudiobookMode] = useState(false);
  const [chapters, setChapters] = useState([]); // [{ href, label }]
  const [chapterIndex, setChapterIndex] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [rate, setRate] = useState(1.0); // 0.75 / 1.0 / 1.25 / 1.5
  const speechChunksRef = useRef([]); // remaining sentence chunks for current chapter
  const shouldContinueRef = useRef(false);

  useEffect(() => {
    (async () => {
      const book = await getBook(bookId);
      if (!book) return;
      setTitle(book.title);
      const base64 = await FileSystem.readAsStringAsync(book.file_path, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const progress = await getProgress(bookId);
      setHtml(READER_HTML(base64, progress ? progress.cfi : null, darkMode));
      await touchBook(bookId);
    })();

    return () => {
      shouldContinueRef.current = false;
      Speech.stop();
      deactivateKeepAwake();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  // Push theme changes into the already-loaded WebView instead of reloading it.
  useEffect(() => {
    webviewRef.current?.postMessage(JSON.stringify({ type: 'setTheme', theme: darkMode ? 'dark' : 'light' }));
  }, [darkMode]);

  // Splits chapter text into TTS-friendly chunks (roughly by sentence,
  // capped in length) so playback can be paused/resumed cleanly and long
  // chapters don't exceed platform speech-string limits.
  const chunkText = (text) => {
    const sentences = text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+|\s*[^.!?]+$/g) || [text];
    const chunks = [];
    let buffer = '';
    for (const s of sentences) {
      if ((buffer + s).length > 500) {
        if (buffer) chunks.push(buffer.trim());
        buffer = s;
      } else {
        buffer += s;
      }
    }
    if (buffer.trim()) chunks.push(buffer.trim());
    return chunks;
  };

  const speakNextChunk = useCallback(() => {
    if (!shouldContinueRef.current) return;
    const next = speechChunksRef.current.shift();
    if (!next) {
      // Chapter finished — advance to the next one automatically.
      goToChapter(chapterIndex + 1, true);
      return;
    }
    Speech.speak(next, {
      rate,
      onDone: () => speakNextChunk(),
      onStopped: () => {},
      onError: () => speakNextChunk(),
    });
  }, [rate, chapterIndex]);

  const goToChapter = useCallback((index, autoStart) => {
    if (index < 0 || index >= chapters.length) {
      shouldContinueRef.current = false;
      setIsSpeaking(false);
      return;
    }
    setChapterIndex(index);
    const chapter = chapters[index];
    webviewRef.current?.postMessage(JSON.stringify({ type: 'displayHref', href: chapter.href }));
    webviewRef.current?.postMessage(JSON.stringify({ type: 'getChapterText', href: chapter.href }));
    if (autoStart) shouldContinueRef.current = true;
  }, [chapters]);

  const startAudiobook = () => {
    if (chapters.length === 0) return;
    setAudiobookMode(true);
    shouldContinueRef.current = true;
    setIsSpeaking(true);
    activateKeepAwakeAsync();
    goToChapter(chapterIndex, true);
  };

  const pauseAudiobook = () => {
    shouldContinueRef.current = false;
    setIsSpeaking(false);
    Speech.stop();
    deactivateKeepAwake();
  };

  const resumeAudiobook = () => {
    shouldContinueRef.current = true;
    setIsSpeaking(true);
    activateKeepAwakeAsync();
    if (speechChunksRef.current.length > 0) {
      speakNextChunk();
    } else {
      goToChapter(chapterIndex, true);
    }
  };

  const stopAudiobook = () => {
    shouldContinueRef.current = false;
    speechChunksRef.current = [];
    setIsSpeaking(false);
    setAudiobookMode(false);
    Speech.stop();
    deactivateKeepAwake();
  };

  const skipChapter = (dir) => {
    Speech.stop();
    speechChunksRef.current = [];
    shouldContinueRef.current = true;
    goToChapter(chapterIndex + dir, true);
  };

  const cycleRate = () => {
    const options = [0.75, 1.0, 1.25, 1.5, 2.0];
    const next = options[(options.indexOf(rate) + 1) % options.length];
    setRate(next);
  };

  // Steps between 80% and 200% text size — helps low-vision readers without
  // needing to leave the reader or rely on OS-level zoom.
  const cycleFontScale = () => {
    const options = [80, 100, 120, 150, 175, 200];
    const currentIdx = options.indexOf(fontScale);
    const next = options[(currentIdx + 1) % options.length];
    setFontScale(next);
    webviewRef.current?.postMessage(JSON.stringify({ type: 'setFontScale', scale: next }));
  };

  const handleMessage = async (event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'progress') {
        await saveProgress(bookId, msg.cfi, msg.percentage);
      }
      if (msg.type === 'currentCfi') {
        await addBookmark(bookId, msg.cfi, 'Bookmark');
      }
      if (msg.type === 'chapters') {
        setChapters(msg.chapters || []);
      }
      if (msg.type === 'chapterText') {
        const chunks = chunkText(msg.text || '');
        speechChunksRef.current = chunks;
        if (chunks.length === 0) {
          // Empty chapter (e.g. image-only page) — skip straight to the next one.
          goToChapter(chapterIndex + 1, true);
        } else if (shouldContinueRef.current) {
          speakNextChunk();
        }
      }
    } catch (e) {
      // ignore malformed messages
    }
  };

  const addBookmarkHere = () => {
    webviewRef.current?.postMessage(JSON.stringify({ type: 'getCfi' }));
  };

  if (!html) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.surface }]}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`Loading ${title || 'book'}`}
      />
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={() => setControlsVisible((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel="Page content"
        accessibilityHint="Tap to show or hide reading controls. Tap left edge for previous page, right edge for next page."
      >
        <WebView
          ref={webviewRef}
          originWhitelist={['*']}
          source={{ html }}
          onMessage={handleMessage}
          javaScriptEnabled
          style={{ flex: 1 }}
          pointerEvents="box-none"
        />
      </TouchableOpacity>

      {controlsVisible && (
        <View style={[styles.topBar, { backgroundColor: colors.bar }]}>
          <TouchableOpacity
            onPress={() => router.back()}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Back to Library"
          >
            <Text style={[styles.barButton, { color: colors.accent }]}>‹ Library</Text>
          </TouchableOpacity>
          <Text style={[styles.barTitle, { color: colors.text }]} numberOfLines={1}>{title}</Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity
              onPress={addBookmarkHere}
              accessible
              accessibilityRole="button"
              accessibilityLabel="Add bookmark"
              accessibilityHint="Saves your current position in this book"
            >
              <Text style={[styles.barButton, { color: colors.accent }]}>Bookmark</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={cycleFontScale}
              accessible
              accessibilityRole="button"
              accessibilityLabel={`Text size, ${fontScale} percent`}
              accessibilityHint="Cycles through larger and smaller text sizes"
            >
              <Text style={[styles.barButton, { color: colors.accent }]}>Aa {fontScale}%</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={audiobookMode ? stopAudiobook : startAudiobook}
              accessible
              accessibilityRole="button"
              accessibilityLabel={audiobookMode ? 'Stop audiobook' : 'Start audiobook, read this book aloud'}
            >
              <Text style={[styles.barButton, { color: colors.accent }]}>{audiobookMode ? 'Stop' : 'Listen'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={toggleDarkMode}
              accessible
              accessibilityRole="switch"
              accessibilityState={{ checked: darkMode }}
              accessibilityLabel="Dark mode"
              accessibilityHint="Switches between light and dark reading theme"
            >
              <Text style={[styles.barButton, { color: colors.accent }]}>{darkMode ? 'Light' : 'Dark'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {audiobookMode && (
        <View
          style={[styles.audioBar, { backgroundColor: colors.bar }]}
          accessible={false}
        >
          <TouchableOpacity
            onPress={() => skipChapter(-1)}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Previous chapter"
          >
            <Text style={[styles.audioButton, { color: colors.text }]}>⏮</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={isSpeaking ? pauseAudiobook : resumeAudiobook}
            style={[styles.playButton, { backgroundColor: colors.accent }]}
            accessible
            accessibilityRole="button"
            accessibilityLabel={isSpeaking ? 'Pause' : 'Play'}
            accessibilityState={{ selected: isSpeaking }}
          >
            <Text style={styles.playButtonText}>{isSpeaking ? '⏸' : '▶'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => skipChapter(1)}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Next chapter"
          >
            <Text style={[styles.audioButton, { color: colors.text }]}>⏭</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={cycleRate}
            style={[styles.rateButton, { borderColor: colors.accent }]}
            accessible
            accessibilityRole="button"
            accessibilityLabel={`Playback speed, ${rate} times`}
            accessibilityHint="Cycles through playback speeds from 0.75 to 2 times"
          >
            <Text style={[styles.rateButtonText, { color: colors.accent }]}>{rate}x</Text>
          </TouchableOpacity>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
            <Text
              style={[styles.chapterLabel, { color: colors.subtext }]}
              numberOfLines={1}
              accessible
              accessibilityLabel={`Now reading: ${chapters[chapterIndex]?.label || `Chapter ${chapterIndex + 1}`}`}
            >
              {chapters[chapterIndex]?.label || `Chapter ${chapterIndex + 1}`}
            </Text>
          </ScrollView>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  barTitle: { fontWeight: '600', flex: 1, marginHorizontal: 8, textAlign: 'center' },
  barButton: { fontWeight: '600' },
  audioBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  audioButton: { fontSize: 20 },
  playButton: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  playButtonText: { color: '#fff', fontSize: 16 },
  rateButton: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 },
  rateButtonText: { fontWeight: '600', fontSize: 12 },
  chapterLabel: { fontSize: 12 },
});
