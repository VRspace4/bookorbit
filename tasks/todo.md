# Anna's Archive Search Integration

- [x] Add a server-side Anna's Archive search/download adapter.
- [x] Expose Anna search/download through the existing Z-Library feature surface.
- [x] Add source switching to the search modal.
- [x] Add browser handoff for Anna's Archive anti-bot challenges.
- [x] Add search-level handoff for Anna's Archive anti-bot search failures.
- [x] Restrict modal search execution to the explicit Search button.
- [x] Add an Openlib-style native WebView mirror resolver for Anna downloads.
- [x] Add focused parser and UI coverage.
- [x] Run focused verification and document results.

## Review

- Added a configurable Anna's Archive backend adapter with current-domain fallbacks: `https://annas-archive.gl`, `https://annas-archive.pk`, and `https://annas-archive.gd`; override with `ANNAS_ARCHIVE_BASE_URLS`.
- Added Anna search parsing, detail-page mirror discovery, slow-download mirror parsing, anti-bot challenge detection, mirror ordering, and direct stream ingestion into Book Dock.
- Integrated Anna's Archive into the existing search modal with a Z-Library / Anna's Archive source switch. Z-Library status, daily-limit, and queue controls stay scoped to Z-Library.
- Added user-mediated Anna's Archive challenge handling: if the server reports an anti-bot challenge, the matching result exposes an Open action for the Anna detail page instead of attempting to bypass the challenge.
- Moved the Anna's Archive challenge notice out of toast notifications and into the challenged result's content box so it remains visible in the modal.
- Added dedicated search-level Anna's Archive challenge handling: the server now returns a 503 challenge payload, and the modal renders an inline Open Anna's Archive handoff when search itself is blocked before results exist.
- Corrected Anna's Archive search requests to the current URL shape: `index=&page=1&sort=&display=&q=...`; format filtering stays local to parsed results instead of using stale `content` / `ext` query parameters.
- Fixed a false anti-bot classification found through live browser testing: normal Anna result pages include `DDOS-GUARD caching` script comments, so challenge detection now only matches actual challenge titles/browser-check text.
- Fixed Anna Add mirror resolution so external Z-Library/Tor MD5 pages are treated as catalog links, not file mirrors, and DDoS-Guard responses on slow-download pages become the existing browser-verification handoff instead of a generic mirror failure.
- Openlib comparison: Openlib does not bypass Anna's challenge server-side. It opens the `/slow_download/...` page in a native WebView, lets the WebView complete browser verification, extracts direct mirror links from the loaded page DOM, then downloads from those mirrors.
- Added the same Openlib-style flow for BookOrbit Android: Anna Add now receives the slow-download challenge URL, launches a native WebView mirror resolver when Android Capacitor is available, retries the Book Dock ingestion with the extracted mirrors, and keeps the inline handoff for desktop web where cross-origin DOM extraction is not available.
- Updated the native WebView resolver to poll for mirrors after page load so Anna's transient `Checking your browser before accessing...` page can disappear automatically before the real slow-download page reveals the link.
- Added server-side ingestion from browser-resolved Anna mirrors with public-host validation before fetching user-provided mirror URLs.
- Removed automatic searches from query input, format changes, source changes, and Enter key handling; users now trigger a search only through the Search button.
- Verification passed:
  - `pnpm --filter server exec vitest run src/modules/zlib/anna-archive.parser.test.ts src/modules/zlib/zlib.controller.test.ts`
  - `pnpm --filter server type-check`
  - `pnpm --filter client test:unit --run src/features/zlib/components/__tests__/ZlibSearchModal.spec.ts`
  - `pnpm --filter server exec eslint src/modules/zlib/anna-archive-api.service.ts src/modules/zlib/anna-archive.parser.ts src/modules/zlib/anna-archive.parser.test.ts src/modules/zlib/zlib.controller.ts src/modules/zlib/zlib.controller.test.ts src/modules/zlib/zlib-api.service.ts src/modules/zlib/dto/zlib-search.dto.ts src/modules/zlib/dto/zlib-download.dto.ts src/config/config.ts`
  - `pnpm --filter client exec eslint src/features/zlib/components/ZlibSearchModal.vue src/features/zlib/components/__tests__/ZlibSearchModal.spec.ts src/components/AppHeader.vue`
  - `pnpm --filter client exec oxlint src/features/zlib/components/ZlibSearchModal.vue src/features/zlib/components/__tests__/ZlibSearchModal.spec.ts src/components/AppHeader.vue`
  - After the browser-handoff change: `pnpm --filter client test:unit --run src/features/zlib/components/__tests__/ZlibSearchModal.spec.ts`, `pnpm --filter client exec eslint src/features/zlib/components/ZlibSearchModal.vue src/features/zlib/components/__tests__/ZlibSearchModal.spec.ts`, and `pnpm --filter client exec oxlint src/features/zlib/components/ZlibSearchModal.vue src/features/zlib/components/__tests__/ZlibSearchModal.spec.ts`
  - After the explicit-search change: `pnpm --filter client test:unit --run src/features/zlib/components/__tests__/ZlibSearchModal.spec.ts`, `pnpm --filter client exec eslint src/features/zlib/components/ZlibSearchModal.vue src/features/zlib/components/__tests__/ZlibSearchModal.spec.ts`, and `pnpm --filter client exec oxlint src/features/zlib/components/ZlibSearchModal.vue src/features/zlib/components/__tests__/ZlibSearchModal.spec.ts`
  - After the inline challenge notice change: `pnpm --filter client test:unit --run src/features/zlib/components/__tests__/ZlibSearchModal.spec.ts`, `pnpm --filter client exec eslint src/features/zlib/components/ZlibSearchModal.vue src/features/zlib/components/__tests__/ZlibSearchModal.spec.ts`, and `pnpm --filter client exec oxlint src/features/zlib/components/ZlibSearchModal.vue src/features/zlib/components/__tests__/ZlibSearchModal.spec.ts`
  - After the search-level challenge handoff change: `pnpm --filter client test:unit --run src/features/zlib/components/__tests__/ZlibSearchModal.spec.ts`, `pnpm --filter server exec vitest run src/modules/zlib/anna-archive-api.service.test.ts src/modules/zlib/anna-archive.parser.test.ts src/modules/zlib/zlib.controller.test.ts`, `pnpm --filter server type-check`, targeted client/server ESLint, and targeted client oxlint.
  - After correcting the Anna search URL: `pnpm --filter server exec vitest run src/modules/zlib/anna-archive-api.service.test.ts src/modules/zlib/anna-archive.parser.test.ts src/modules/zlib/zlib.controller.test.ts`, `pnpm --filter client test:unit --run src/features/zlib/components/__tests__/ZlibSearchModal.spec.ts`, `pnpm --filter server type-check`, targeted client/server ESLint, and targeted client oxlint.
  - After live browser testing with `edge-devtools-local` on port 9230: Anna search for `Art of Spending Money` returned HTTP 200 and rendered 20 EPUB results after tightening challenge detection; supporting checks were `pnpm --filter server exec vitest run src/modules/zlib/anna-archive.parser.test.ts src/modules/zlib/anna-archive-api.service.test.ts src/modules/zlib/zlib.controller.test.ts`, targeted server ESLint, and `pnpm --filter server type-check`.
  - After the Anna Add mirror-resolution fix: `pnpm --filter server exec vitest run src/modules/zlib/anna-archive-api.service.test.ts src/modules/zlib/anna-archive.parser.test.ts src/modules/zlib/zlib.controller.test.ts`, `pnpm --filter server exec eslint src/modules/zlib/anna-archive-api.service.ts src/modules/zlib/anna-archive-api.service.test.ts src/modules/zlib/anna-archive.parser.ts src/modules/zlib/anna-archive.parser.test.ts`, `pnpm --filter server type-check`, and live `edge-devtools-local` retest where Add returned the inline `Browser verification required` handoff instead of `No working Anna’s Archive download mirror found`.
  - After the Openlib-style native resolver change: `pnpm --filter server exec vitest run src/modules/zlib/anna-archive-api.service.test.ts src/modules/zlib/anna-archive.parser.test.ts src/modules/zlib/zlib.controller.test.ts`, `pnpm --filter client test:unit --run src/features/zlib/components/__tests__/ZlibSearchModal.spec.ts`, `pnpm --filter server type-check`, targeted client/server ESLint, targeted client oxlint, `pnpm --filter client build-only`, `pnpm --filter client exec cap sync android`, and `ANDROID_HOME=$HOME/.cache/bookorbit-android-sdk ANDROID_SDK_ROOT=$HOME/.cache/bookorbit-android-sdk JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew :app:assembleDebug`.
  - After the Anna browser-check polling update: `ANDROID_HOME=$HOME/.cache/bookorbit-android-sdk ANDROID_SDK_ROOT=$HOME/.cache/bookorbit-android-sdk JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew :app:assembleDebug` and `git diff --check -- client/android/app/src/main/java/app/bookorbit/mobile/AnnaMirrorResolverActivity.java`.
  - `git diff --check -- server/src/modules/zlib/anna-archive-api.service.ts server/src/modules/zlib/anna-archive.parser.ts server/src/modules/zlib/anna-archive.parser.test.ts server/src/modules/zlib/zlib.controller.ts server/src/modules/zlib/zlib.controller.test.ts server/src/modules/zlib/zlib-api.service.ts server/src/modules/zlib/dto/zlib-search.dto.ts server/src/modules/zlib/dto/zlib-download.dto.ts server/src/config/config.ts client/src/features/zlib/components/ZlibSearchModal.vue client/src/features/zlib/components/__tests__/ZlibSearchModal.spec.ts client/src/components/AppHeader.vue tasks/todo.md`
- Verification limitations:
  - `pnpm --filter client type-check` is still blocked by existing unrelated reader highlight/settings type errors in `color-utils.ts`, `useReaderSettings.ts`, `theme-highlight.spec.ts`, and `useReaderSettings.spec.ts`.
  - An accidental full `pnpm --filter server test -- ...` run invoked the full suite and failed on existing unrelated CSP/architecture/book progress/reader preference expectations; the focused zlib tests passed with direct Vitest invocation.

# Capacitor Android APK

- [x] Audit existing PWA/mobile changes and native build prerequisites.
- [x] Add Capacitor Android shell and mobile runtime configuration.
- [x] Build web assets and sync them into Android.
- [x] Generate an installable debug APK.
- [x] Run focused verification and document the APK path.

## Review

- Added a Capacitor Android project under `client/android` with app id `app.bookorbit.mobile`.
- Added build scripts for syncing and assembling the Android debug APK.
- Added `BOOKORBIT_ANDROID_SERVER_URL` support in `client/capacitor.config.ts`; the generated APK targets `https://bookorbit.ridethew.com`.
- Installed Android SDK platform/build tools 36 under `~/.cache/bookorbit-android-sdk` and OpenJDK 21 JDK on the server for Gradle builds.
- APK output: `client/android/app/build/outputs/apk/debug/app-debug.apk`.
- Verification passed:
  - `BOOKORBIT_ANDROID_SERVER_URL=https://bookorbit.ridethew.com pnpm run build:android:apk` after fixing root-owned generated `dist` files and installing the JDK.
  - `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew assembleDebug`.
  - `apksigner verify --verbose client/android/app/build/outputs/apk/debug/app-debug.apk`.
  - `aapt dump badging client/android/app/build/outputs/apk/debug/app-debug.apk`.

# Android Reader Resume Flash

- [x] Document the Android APK resume flash while returning to Reading mode.
- [x] Trace native resume and reader mount/restore behavior.
- [x] Prevent avoidable reload/loading flashes when resuming from Android recents.
- [x] Run focused verification and rebuild the APK.
- [x] Document the updated APK path/link.

## Review

- Added Android native route persistence in `MainActivity` so a recreated Capacitor activity saves/restores the current WebView route and starts directly on the last private route instead of loading `/` first.
- Updated web route persistence to treat Capacitor native Android/iOS as installed-app mode, so root launches still restore the last reader route when the native shell cannot provide a direct start path.
- Rebuilt the debug APK at `client/android/app/build/outputs/apk/debug/app-debug.apk`; the download endpoint returns the new 9,146,185-byte APK with `content-type: application/vnd.android.package-archive`.
- Verification passed:
  - `pnpm --filter client test:unit --run src/features/pwa/lib/__tests__/native-app.spec.ts` (1 file / 7 tests)
  - `ANDROID_HOME=$HOME/.cache/bookorbit-android-sdk ANDROID_SDK_ROOT=$HOME/.cache/bookorbit-android-sdk JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew :app:assembleDebug`
  - `BOOKORBIT_ANDROID_SERVER_URL=https://bookorbit.ridethew.com ANDROID_HOME=$HOME/.cache/bookorbit-android-sdk ANDROID_SDK_ROOT=$HOME/.cache/bookorbit-android-sdk JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 pnpm run build:android:apk`
  - `pnpm --filter client exec oxlint src/features/pwa/lib/native-app.ts src/features/pwa/lib/__tests__/native-app.spec.ts`
  - `pnpm --filter client exec eslint src/features/pwa/lib/native-app.ts src/features/pwa/lib/__tests__/native-app.spec.ts`
  - `apksigner verify --verbose client/android/app/build/outputs/apk/debug/app-debug.apk`
  - `aapt dump badging client/android/app/build/outputs/apk/debug/app-debug.apk`
  - `git diff --check -- client/src/features/pwa/lib/native-app.ts client/src/features/pwa/lib/__tests__/native-app.spec.ts client/android/app/src/main/java/app/bookorbit/mobile/MainActivity.java tasks/todo.md`
  - `curl -k -I 'https://mc.ridethew.com/_file-download?path=%2Fhome%2Fvrspace4%2Fprojects%2Fbookorbit%2Fsource%2Fclient%2Fandroid%2Fapp%2Fbuild%2Foutputs%2Fapk%2Fdebug%2Fapp-debug.apk'`
- Verification limitations:
  - Full `pnpm --filter client lint:check` is blocked by existing mock type-parameter errors in `src/features/reader/shared/composables/__tests__/useVisibility.spec.ts`.
  - The Android emulator container was running but ADB showed no attached booted device, so live Android recents/resume reproduction was not available without restarting emulator infrastructure.

# Android Resume Logout

- [ ] Document the Android resume logout regression.
- [ ] Persist WebView auth cookies when the native activity pauses/stops.
- [ ] Avoid rotating refresh tokens on every short foreground switch.
- [ ] Rebuild and verify the APK on the connected Android phone.
- [ ] Document the updated APK link and verification results.

# EPUB TTS Feature Set

- [x] Map existing reader and Modern Code TTS integration points.
- [x] Add TTS setting types, defaults, and validation.
- [x] Add backend TTS proxy endpoints for xAI and Google Chirp 3.
- [x] Add client TTS engine controllers for device, Azure, Google, and xAI.
- [x] Add EPUB sentence and word highlighting.
- [x] Add in-reader TTS controls and settings UI.
- [x] Run focused verification and document results.

## Review

- Added EPUB TTS settings, validation, xAI/Google proxy endpoints, Azure CSP allowances, reader controls, local credential storage, engine/voice selectors, and Foliate document text highlighting.
- Reused Modern Code's xAI native `/v1/tts` payload shape and Azure DragonHD voice catalog/region guidance.
- Verification passed:
  - `pnpm --filter @bookorbit/types build`
  - `pnpm --filter client type-check`
  - `pnpm --filter server type-check`
  - `pnpm --filter client lint:check`
  - `pnpm --filter server lint:check`
  - `pnpm --filter client test:unit --run src/features/reader/epub/components/__tests__/ReaderHeader.spec.ts src/features/reader/epub/components/__tests__/TtsControls.spec.ts src/features/reader/epub/composables/__tests__/useFoliate.spec.ts src/features/reader/epub/tts/__tests__/word-index.spec.ts` (4 files / 11 tests)
  - `pnpm --filter server test -- src/modules/tts/tts.service.test.ts src/modules/reader-preferences/reader-preferences.service.test.ts src/common/utils/bootstrap.utils.test.ts` (ran the full server suite: 448 files / 5,189 tests)
- Environment note: commands warn that the root workspace wants Node >=24; this shell is Node v22.22.2, but the verification commands above completed successfully after fixing stale root-owned generated output directories.

# Immediate TTS Settings Apply

- [x] Document the immediate-apply behavior requested for the TTS sheet.
- [x] Trace the current settings sheet buffering and active playback flow.
- [x] Apply TTS sheet edits immediately to reader settings.
- [x] Restart active playback from the current highlighted word when engine-affecting settings change.
- [x] Add focused regression coverage.
- [x] Run focused client verification and document results.

## Review

- Added a live TTS settings watcher that restarts active `speaking`/`loading` playback from the current word when provider, voice, rate, pitch, volume, or provider credentials change.
- Fixed runtime cleanup ordering so an engine switch stops the current Web Audio source even though abort handlers also clear runtime state.
- Highlight color changes still apply through the existing style-injection watcher without forcing an audio restart.
- Verification passed:
  - `sudo docker exec bookorbit-dev sh -lc 'pnpm --filter client test:unit --run src/features/reader/epub/composables/__tests__/useEpubTts.spec.ts src/features/reader/epub/components/__tests__/TtsSettingsPanel.spec.ts'` (2 files / 9 tests)
  - `sudo docker exec bookorbit-dev sh -lc 'pnpm --filter client type-check'`
  - `sudo docker exec bookorbit-dev sh -lc 'pnpm --filter client lint:check'`

# Reader Exit Recovery

- [x] Document the reader-exit trap and expected navigation behavior.
- [x] Trace reader back-button handling and standalone PWA route restore.
- [x] Add a shared reader-exit helper that uses real back history when available and falls back to Dashboard.
- [x] Apply the helper to EPUB, PDF, CBZ, and audiobook reader exits.
- [x] Preserve a Dashboard history entry behind standalone PWA restored routes so native Back can leave reader mode.
- [x] Add focused regression coverage.
- [x] Run focused client verification and document results.

## Review

- Added a shared reader-exit helper that uses Vue Router back only when the browser history has a valid non-reader app route behind the reader; otherwise it replaces the current route with Dashboard.
- Wired that helper into EPUB, PDF, CBZ, and audiobook reader exit controls, so direct/restored reader launches no longer leave the top-left back action as a no-op.
- Changed standalone PWA launch restore to load the saved route with `router.push()` after the root route initializes, leaving Dashboard behind the restored reader so native Back can leave reader mode instead of immediately closing the app.
- Verification passed:
  - `sudo docker exec bookorbit-dev sh -lc 'pnpm --filter client test:unit --run src/features/reader/shared/lib/__tests__/reader-navigation.spec.ts src/features/pwa/lib/__tests__/native-app.spec.ts src/features/reader/epub/components/__tests__/ReaderHeader.spec.ts src/features/reader/pdf-v4/__tests__/PdfV4ReaderView.spec.ts'` (4 files / 36 tests)
  - `sudo docker exec bookorbit-dev sh -lc 'pnpm --filter client type-check'`
  - `sudo docker exec bookorbit-dev sh -lc 'pnpm --filter client lint:check'`
  - `git diff --check`
  - `curl -fsS https://bookorbit.ridethew.com/src/features/reader/shared/lib/reader-navigation.ts | rg -n "exitReader|dashboard|isReaderPath"`
  - `curl -fsS https://bookorbit.ridethew.com/src/features/pwa/lib/native-app.ts | rg -n "pendingLaunchRestore|router\\.push\\(redirect\\)|fullPath === '/'"`
  - `curl -fsS https://bookorbit.ridethew.com/src/features/reader/ReaderView.vue | rg -n "exitReader|await exitReader"`
  - `sudo docker exec bookorbit-dev sh -lc 'cd /app && VITE_PORT=5999 timeout 8 pnpm --filter client exec vite --host 127.0.0.1'` (loaded config and served on the throwaway port before timeout stopped it)
- Environment note: recent `bookorbit-dev` logs showed one transient Vite config reload warning at 4:02 PM America/Los_Angeles, but the current config loads cleanly and the remote dev app is serving the updated source.

# TTS Highlight Regression

- [x] Confirm whether playback timing still drives active word changes.
- [x] Fix EPUB sentence and word highlight rendering in XHTML chapter documents.
- [x] Add focused coverage for XHTML highlight style/markup injection.
- [x] Run focused client verification.

## Review

- Fixed TTS highlight rendering by creating injected EPUB highlight spans and styles with the XHTML namespace when a chapter document is XHTML/XML.
- Strengthened highlight CSS with important `background-color` rules so book styles are less likely to hide sentence and active-word marks.
- Verification passed:
  - `pnpm --filter client test:unit --run src/features/reader/epub/tts/__tests__/word-index.spec.ts src/features/reader/epub/components/__tests__/TtsControls.spec.ts` (2 files / 4 tests)
  - `pnpm --filter client type-check`
  - `pnpm --filter client lint:check`
  - `git diff --check`

# Native App PWA Resume

- [x] Document PWA/resume implementation plan.
- [x] Add native install controls and iOS install guidance.
- [x] Replace automatic service-worker reload behavior with user-controlled updates.
- [x] Persist reader progress locally before network sync so reader relaunch can restore immediately.
- [x] Restore the last in-app route when launched from an installed standalone app.
- [x] Expand safe runtime caching for app shell reader assets and reader metadata.
- [x] Clear user-specific PWA caches on logout.
- [x] Run focused verification and document results.

## Review

- Added a global PWA lifecycle surface that manually registers the service worker, prompts for install/update actions, and avoids automatic update reloads while a reader session is active.
- Added a Native App settings card and account-menu install action, with iOS Add to Home Screen guidance when the browser cannot expose `beforeinstallprompt`.
- Added standalone launch route persistence so installed-app launches from `/` restore the last private route, including `/read/...`.
- Added local reader progress snapshots that are written immediately on relocation and used before server progress, then re-synced if the local snapshot is newer.
- Expanded Workbox runtime caching for reader-safe GET surfaces: EPUB info/assets, reader preferences/defaults, book details, covers/thumbnails, CBZ page metadata/pages, and fonts.
- Enabled PWA service-worker registration for the remote HTTPS dev app when `VITE_HMR_HOST` is set, while keeping local dev disabled unless `VITE_PWA_DEV=true`.
- Added logout cleanup for user-specific PWA caches and local reader/TTS resume state.
- Added `workbox-window` as an explicit client dependency because manual `virtual:pwa-register` imports require it during the production Vite build.
- Verification passed:
  - `pnpm --filter client test:unit --run src/features/pwa/composables/__tests__/useInstallPrompt.test.ts src/features/pwa/lib/__tests__/native-app.spec.ts src/features/reader/shared/composables/__tests__/useReaderProgress.spec.ts` (3 files / 34 tests)
  - `pnpm --filter client build`
  - `pnpm --filter client lint:check`
  - `git diff --check`
  - `curl -fsS https://bookorbit.ridethew.com/src/features/pwa/composables/usePwaServiceWorker.ts | rg -n "VITE_HMR_HOST|virtual:pwa-register|onNeedReload|updateServiceWorker\\(false\\)"`
  - `curl -fsS https://bookorbit.ridethew.com/src/features/reader/shared/composables/useReaderProgress.ts | rg -n "readCachedReaderProgress|writeCachedReaderProgress|flushKeepalive|getAccessToken"`
  - `curl -fsS https://bookorbit.ridethew.com/src/features/pwa/lib/native-app.ts | rg -n "resolveStandaloneLaunchRedirect|launchRestoreAttempted|clearBookorbitRuntimeCaches|reader:progress"`
- Environment note: commands warn that this shell is Node v22.22.2 while the root workspace wants Node >=24, but the client verification completed successfully.

# PWA Dev Dependency Resolution

- [x] Record the Vite `workbox-window` resolution failure.
- [x] Verify dependency declaration and installed module state.
- [x] Refresh the running dev container install if the package is declared but not linked.
- [x] Run focused Vite/PWA import verification.
- [x] Document results.

## Review

- Root cause: `workbox-window` was already declared in `client/package.json` and locked in `pnpm-lock.yaml`, but the running `bookorbit-dev` container had stale `node_modules` from before that dependency was linked.
- Ran `pnpm install --frozen-lockfile` inside `bookorbit-dev`, then restarted the dev container so Vite would drop the failed transform cache and re-optimize dependencies.
- Verification passed:
  - `sudo docker exec bookorbit-dev sh -lc 'node -e "console.log(require.resolve(\"workbox-window\",{paths:[\"/app/client\"]}))"'`
  - `sudo docker exec bookorbit-dev sh -lc 'pnpm --filter client build'`
  - `curl -fsS https://bookorbit.ridethew.com/@vite-plugin-pwa/virtual:pwa-register | rg -n "workbox-window|registerSW|dev-sw"`
  - `curl -i -sS 'https://bookorbit.ridethew.com/node_modules/.vite/deps/workbox-window.js?v=c9eca161'`
  - `git diff --check`

# Cloud TTS Sentence Gap

- [x] Trace the xAI/cloud TTS sentence playback pipeline.
- [x] Prefetch and decode the next cloud sentence while the current sentence is speaking.
- [x] Trim leading/trailing cloud TTS audio padding.
- [x] Save and restore the last TTS read position.
- [x] Allow tapping a word in TTS mode to read from that point.
- [x] Run focused client verification.

## Review

- Removed the xAI/GCP sentence handoff delay by keeping one shared Web Audio context for cloud playback and prefetching/decoding the next sentence before the current one ends.
- Trimmed leading/trailing near-silence from decoded cloud TTS buffers to remove provider-side audio padding between sentences.
- Added saved TTS word position restore and tap-word-to-read while TTS mode is active.
- Added focused composable tests for xAI prefetching, saved resume, and tap-to-read, plus a word-point mapping test.
- Verification passed:
  - `pnpm --filter client test:unit --run src/features/reader/epub/composables/__tests__/useEpubTts.spec.ts src/features/reader/epub/tts/__tests__/word-index.spec.ts` (2 files / 6 tests)
  - `pnpm --filter client type-check`
  - `pnpm --filter client lint:check`
  - `git diff --check`
  - `curl -fsS https://bookorbit.ridethew.com/src/features/reader/epub/composables/useFoliateInput.ts | rg -n "stableTouchPoint|touchStartScreen"`

# Kokoro TTS Speed Control

- [x] Verify OpenRouter speech speed parameter support.
- [x] Send Kokoro speed through the OpenRouter proxy.
- [x] Expose the existing TTS rate control for Kokoro.
- [x] Add focused client/server coverage.
- [x] Run focused verification.

## Review

- OpenRouter's speech API documents `speed` as an optional request parameter for `/api/v1/audio/speech`; support can vary by model/provider, so Kokoro now forwards the reader rate through the proxy without changing the shared TTS setting model.
- Kokoro requests now send `speed: settings().ttsRate` from the EPUB reader to `/api/v1/tts/kokoro`, and the server forwards a clamped `speed` value to OpenRouter.
- The Kokoro settings panel now shows the existing rate slider, matching the bottom toolbar speed chip.
- Verification passed:
  - `pnpm --filter client test:unit --run src/features/reader/epub/composables/__tests__/useEpubTts.spec.ts src/features/reader/epub/components/__tests__/TtsSettingsPanel.spec.ts` (2 files / 5 tests)
  - `pnpm --filter server test -- src/modules/tts/tts.service.test.ts` (ran the full server suite: 448 files / 5,190 tests)
  - `pnpm --filter client type-check`
  - `pnpm --filter client lint:check`
  - `pnpm --filter server type-check`
  - `git diff --check`
  - `curl -fsS https://bookorbit.ridethew.com/src/features/reader/epub/composables/useEpubTts.ts | rg -n "speed: settings\\(\\)\\.ttsRate|/api/v1/tts/kokoro"`
  - `curl -fsS https://bookorbit.ridethew.com/src/features/reader/epub/components/TtsSettingsPanel.vue | rg -n "settings\\.ttsProvider !== 'xai'|Rate"`

# High-Speed Cloud TTS Sentence Gaps

- [x] Trace why 2x cloud TTS still pauses between sentences.
- [x] Increase cloud TTS audio prefetch depth while preserving ordered playback.
- [x] Add focused coverage for multi-sentence prefetching.
- [x] Run focused verification.

## Review

- Fixed high-speed cloud TTS gaps by changing the sentence queue from single-sentence lookahead to a four-sentence prefetch window. Playback order is still sequential, but upcoming cloud audio now starts synthesizing/decoding before the previous sentence finishes.
- Added a focused 2x playback regression test that verifies multiple upcoming sentences are prefetched and the prefetch window stays filled as playback advances.
- Verification passed:
  - `pnpm --filter client test:unit --run src/features/reader/epub/composables/__tests__/useEpubTts.spec.ts` (1 file / 5 tests)
  - `pnpm --filter client type-check`
  - `pnpm --filter client lint:check`
  - `git diff --check`
  - `curl -fsS https://bookorbit.ridethew.com/src/features/reader/epub/composables/useEpubTts.ts | rg -n "CLOUD_PREFETCH_SENTENCE_COUNT|queueAhead|pending\\.set"`

# All-Engine TTS Sentence Gaps

- [x] Confirm which engines still use strictly sequential sentence submission.
- [x] Apply queued playback/prefetch behavior to Azure and device TTS.
- [x] Add focused coverage for non-cloud queued playback.
- [x] Run focused verification.

## Review

- Extended no-gap high-speed playback to every TTS engine: xAI, Google Chirp 3, Kokoro, and Azure use the shared four-sentence audio prefetch window; device/browser TTS queues all sentence utterances up front into the native speech queue.
- Moved Azure SDK loading outside the per-sentence preparation path so the Azure prefetch window can fill promptly.
- Added focused tests for Azure prefetch behavior and browser/device queued utterances.
- Verification passed:
  - `pnpm --filter client test:unit --run src/features/reader/epub/composables/__tests__/useEpubTts.spec.ts` (1 file / 7 tests)
  - `pnpm --filter client type-check`
  - `pnpm --filter client lint:check`
  - `git diff --check`
  - `curl -fsS https://bookorbit.ridethew.com/src/features/reader/epub/composables/useEpubTts.ts | rg -n "AUDIO_PREFETCH_SENTENCE_COUNT|playAzureAudioQueue|playBrowserQueue|speechSynthesis\\.speak|queueAhead"`

# Kokoro OpenRouter TTS

- [x] Verify current OpenRouter TTS endpoint and Kokoro model voice list.
- [x] Add Kokoro/OpenRouter settings, credentials, and validation.
- [x] Add backend Kokoro proxy endpoint.
- [x] Wire Kokoro into the EPUB TTS cloud playback path and settings UI.
- [x] Replace the visible Device engine with Kokoro while preserving browser fallback.
- [x] Run focused client/server verification.

## Review

- Added Kokoro as an EPUB TTS provider backed by OpenRouter model `hexgrad/kokoro-82m` through the OpenAI-compatible `/api/v1/audio/speech` endpoint.
- Added local OpenRouter API key storage, Kokoro voice selection, reader settings defaults/validation, and a `/api/v1/tts/kokoro` backend proxy.
- Replaced the visible Device engine with Kokoro in the TTS settings selector. The browser/device voice remains as an internal fallback if a cloud provider is missing credentials.
- Verification passed:
  - `pnpm --filter @bookorbit/types build`
  - `pnpm --filter client test:unit --run src/features/reader/epub/composables/__tests__/useEpubTts.spec.ts src/features/reader/epub/components/__tests__/TtsControls.spec.ts src/features/reader/epub/tts/__tests__/word-index.spec.ts` (3 files / 9 tests)
  - `pnpm --filter server test -- src/modules/tts/tts.service.test.ts src/modules/reader-preferences/reader-preferences.service.test.ts` (ran the full server suite: 448 files / 5,190 tests)
  - `pnpm --filter client type-check`
  - `pnpm --filter client lint:check`
  - `pnpm --filter server type-check`
  - `git diff --check`
- Environment note: server type-check initially hit root-owned `server/dist/tsconfig.build.tsbuildinfo`; ownership was corrected with `sudo chown -R vrspace4:vrspace4 server/dist packages/types/dist`, then the check passed.

# EPUB Scrolled Touch Jump

- [x] Trace Foliate scrolled-layout touch handling.
- [x] Fix vertical drag classification so long scroll gestures do not become viewport/page jumps.
- [x] Add focused regression coverage for iframe-relative touch coordinate drift.
- [x] Run focused client verification.

## Review

- Fixed EPUB touch gesture classification to use screen-stable touch coordinates instead of iframe-relative `clientX/clientY` when deciding whether a gesture is a horizontal page turn, vertical scroll, or tap.
- Added a regression test for the scrolled-layout case where the iframe moves with the parent scroller, leaving iframe-relative `clientY` unchanged during a real vertical drag.
- Verification passed:
  - `pnpm --filter client test:unit --run src/features/reader/epub/composables/__tests__/useFoliateInput.spec.ts` (1 file / 8 tests)
  - `pnpm --filter client type-check`
  - `pnpm --filter client lint:check`
  - `git diff --check`

# TTS Restore Centering

- [x] Trace current TTS highlight restore and scroll-follow behavior.
- [x] Center restored TTS highlighted word after launch/reload.
- [x] Add focused regression coverage for restore centering.
- [x] Run focused verification.

## Review

- Added a short retrying restore-centering pass after the saved TTS highlight is rebuilt, so launch/reload timing with Foliate layout settling still recenters the active word.
- Changed live TTS follow mode to recenter on each highlighted word update instead of relying on the EPUB iframe sticky-band check.
- Updated Foliate centering to use the paginator for both scrolled and paginated layouts; live follow now animates Foliate scroll deltas smoothly.
- Cancel restore-centering retries when follow mode is detached, TTS stops, or the composable unmounts.
- Added a focused regression test that drives restore animation frames and verifies the active TTS highlight is centered again after the initial restore pass.
- Verification:
  - `pnpm --filter client test:unit --run src/features/reader/epub/tts/__tests__/word-index.spec.ts` passed (1 file / 7 tests).
  - `pnpm --filter client test:unit --run src/features/reader/epub/composables/__tests__/useEpubTts.spec.ts -t "keeps centering the restored TTS highlight"` passed (1 test).
  - `git diff --check` passed.
  - `pnpm --filter client type-check` still fails on existing unrelated issues: missing `cronstrue` type/module resolution and two `Element.click` type errors in `TtsControls.spec.ts`.

# Paused TTS Follow Section

- [x] Trace paused TTS highlight behavior when manually changing sections.
- [x] Keep the paused highlight anchored to its saved section instead of rendering it in the newly viewed section.
- [x] Make the floating Follow action navigate back to the saved TTS section and center the highlighted word.
- [x] Add focused regression coverage.
- [x] Run focused verification.

## Review

- Added section ownership to the current TTS highlight so paused word indexes are only restored into their source EPUB section.
- Prevented paused TTS restore/prefetch/resume paths from applying the old word index to a different active section.
- Changed the floating Follow action to navigate back to the saved TTS section, rebuild the highlight there, and center the active word.
- Added focused regression coverage for navigating away while TTS is paused.
- Verification:
  - `pnpm --filter client test:unit --run src/features/reader/epub/composables/__tests__/useEpubTts.spec.ts -t "keeps a paused highlight anchored"` passed (1 test).
  - `git diff --check` passed.
  - `pnpm --filter client type-check` still fails on existing unrelated worktree issues: missing `@capacitor/app`, incomplete `ThemeHighlightColors` fixtures, `color-utils.ts` possible undefined access, and a `useReaderSettings.ts` argument type error.
  - Full `useEpubTts.spec.ts` still fails on existing unrelated media-session/TTS-usage expectations in this worktree; the new focused paused-section regression passes.
