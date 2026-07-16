# EPUB Reader (React Native + Expo)

A cross-platform EPUB reader with a local SQLite library (books, reading
progress, bookmarks). Runs on iOS and Android from one codebase, and builds
to a real installable **.apk** (Android) and **.ipa** (iOS) via EAS Build.

## Features
- Import `.epub` files from device storage
- Local library grid with covers, title, author, and reading-progress bar
- Full EPUB rendering via `epub.js` inside a WebView (pagination, tap zones
  to turn pages)
- Per-book reading position saved automatically (SQLite) — resume where you left off
- Bookmarks table (extend the UI to list/jump to them)
- **Audiobook mode** — reads the EPUB's actual text aloud using the device's
  built-in text-to-speech engine (offline, no extra audio files):
  - Tap **Listen** to start; the reader auto-extracts the table of contents
    and reads chapter by chapter, auto-advancing when one finishes
  - Play / pause, skip to previous/next chapter, and a speed cycler
    (0.75x → 2x)
  - The visible page syncs to whatever chapter is currently being read
  - Keeps the screen awake while playing (`expo-keep-awake`)
- Light/Dark reading theme toggle
- Long-press a book in the library to remove it

## Stack
- **Expo (React Native)** — one codebase for iOS + Android
- **expo-sqlite** — on-device database (books, progress, bookmarks)
- **react-native-webview** + **epub.js** (loaded from CDN) — EPUB rendering/pagination
- **expo-speech** — on-device text-to-speech for audiobook playback
- **expo-document-picker** + **jszip** — importing EPUBs and reading cover/title/author from the OPF
- **React Navigation** — Library ↔ Reader screens

## Project layout
```
EpubReaderApp/
  App.js                 # navigation + DB init
  app.json                # Expo app config (bundle IDs, icons)
  eas.json                 # build profiles (apk / ipa)
  db/database.js           # SQLite schema + CRUD (books, progress, bookmarks)
  utils/epubUtils.js       # EPUB metadata/cover extraction, file import
  screens/LibraryScreen.js # book grid + import
  screens/ReaderScreen.js  # WebView + epub.js reader
```

## 1. Run it locally

```bash
npm install
npx expo start
```
Scan the QR code with Expo Go (iOS/Android) for quick testing. Note: Expo Go
supports WebView + SQLite out of the box, so no native rebuild is needed for
development.

## 2. Build a real Android APK

```bash
npm install -g eas-cli
eas login
eas build -p android --profile preview
```
This produces a downloadable `.apk` link when the build finishes (EAS builds
in the cloud, no Android Studio required). Install it directly on a device,
or side-load for testing outside the Play Store.

For a Play Store release, use `--profile production` (builds an `.aab`).

## 3. Build a real iOS IPA

```bash
eas build -p ios --profile preview
```
You'll need an Apple Developer account (EAS will walk you through
provisioning profiles/certificates interactively, or generate them for you).
The `preview` profile produces an installable `.ipa` for ad-hoc/TestFlight
distribution; `production` profile targets App Store submission
(`eas submit -p ios` after).

## Notes & next steps
- `app.json` — change `ios.bundleIdentifier` and `android.package` to your
  own reverse-domain identifiers before building.
- Cover extraction and OPF parsing use lightweight regex rather than a full
  XML parser — reliable for the vast majority of EPUB2/EPUB3 files, but you
  can swap in `fast-xml-parser` for stricter compliance if you hit an
  unusual file.
- To surface bookmarks in the UI, query `getBookmarks(bookId)` from
  `db/database.js` and render a list on the Reader screen that calls
  `rendition.display(cfi)` via `webviewRef.current.postMessage(...)`.
- Table of contents / chapter navigation can be added by reading
  `book.navigation` from epub.js and posting it back to React Native the
  same way `progress` messages work now.
- **Audiobook voice**: `expo-speech` uses whatever TTS voices are installed
  on the device. Call `Speech.getAvailableVoicesAsync()` to list them and
  pass a `voice` option into `Speech.speak()` if you want to let users pick
  a specific voice/language.
- **Android pause caveat**: Android's TTS engine doesn't support true
  pause/resume mid-utterance the way iOS does — `pauseAudiobook()` calls
  `Speech.stop()` under the hood there, so "resume" restarts the current
  chunk (not the whole chapter) rather than mid-sentence. This is a
  platform limitation, not a bug in the app.
- Audiobook progress currently isn't persisted separately from reading
  position — since `displayHref` also updates the visible page/CFI, closing
  the book mid-audiobook still resumes at roughly the right spot next time.
