# FFmpeg Studio for Android and iPhone

The phone version of FFmpeg Studio. It does the same jobs as the desktop app: convert,
compress, resize and trim video, audio and images, with [ffmpeg](https://ffmpeg.org)
built into the app. Nothing is uploaded anywhere; everything runs on the phone.

It's built with React Native and Expo, from one codebase for both platforms. You don't
need an app store: install it straight onto your own phone.

## What it does

- **Pick a file** from Photos / Gallery, or from Files.
- **Convert** video to MP4, MOV, MKV, WebM or animated GIF, audio to MP3, M4A, OGG or
  WAV, and images to JPG, PNG or WebP. Only formats the file can become are shown.
- **Shrink files** with a quality level (High quality, Balanced, Smallest) or a
  **target size in MB**. Video uses a two-pass encode to land just under the target;
  images try a few quality levels and keep the best one that fits.
- **Resize** video to 1080p, 720p, 480p and so on (only sizes smaller than the original),
  and images to 75%, 50% or 25%.
- **Trim** by start and end time (`75`, `1:15` and `0:01:15` all work).
- **Remove audio**, or pull just the audio out of a video. Pick the GIF frame rate.
- Settings start out **matching the file you picked**: same format, same size, original
  resolution.
- A **progress bar** and **Cancel** button, and the result says how much smaller it is.
- The result is always a **new file**. Tap **Save** to put it in a folder (Android) or
  in Files or Photos (iPhone), or **Share** to send it to another app.

## Install on Android

**Easiest: download the APK GitHub builds.**

1. On GitHub, open the repo's **Actions** tab, then the latest green **Mobile app** run.
2. Under **Artifacts**, download **ffmpeg-studio-android** and unzip it.
3. Copy `ffmpeg-studio-arm64-v8a.apk` to your phone (any phone from the last several
   years; use `armeabi-v7a` only for very old phones).
4. Open the APK on the phone. Android asks you to allow installing apps from that source
   (your browser or file manager); allow it, then tap **Install**.

**Or build it yourself** on a computer with Node.js 20+, JDK 17 and the Android SDK
(installing [Android Studio](https://developer.android.com/studio) gives you both):

```bash
cd mobile
npm install
npm run android:apk
```

The APKs land in `mobile/android/app/build/outputs/apk/release/`. Or plug the phone in with
USB debugging on and run `npx expo run:android --variant release` to build and install in
one go.

## Install on iPhone

Apple only lets you install your own apps through Xcode, so you need a Mac. A free Apple
ID is enough; you don't need the paid developer program.

1. Install [Xcode](https://apps.apple.com/app/xcode/id497799835) from the Mac App Store,
   open it once, and sign in with your Apple ID under **Xcode › Settings › Accounts**.
2. Install [Node.js](https://nodejs.org) 20 or newer and CocoaPods (`brew install cocoapods`).
3. Generate the Xcode project:

   ```bash
   cd mobile
   npm install
   npx expo prebuild --platform ios
   open ios/FFmpegStudio.xcworkspace
   ```

4. In Xcode, click **FFmpegStudio** in the left sidebar, open **Signing & Capabilities**,
   and pick your Apple ID under **Team**. If Xcode says the bundle identifier is taken,
   change `com.karan5656.ffmpegstudio` to something unique, like `com.yourname.ffmpegstudio`.
5. Plug in the iPhone, unlock it, and pick it at the top of the Xcode window.
   Choose **Product › Scheme › Edit Scheme › Run › Build Configuration › Release** so the
   app runs without your Mac, then press **Run** (▶).
6. The first time, the iPhone needs two approvals:
   - **Settings › Privacy & Security › Developer Mode**: turn it on and restart.
   - **Settings › General › VPN & Device Management**: tap your Apple ID and **Trust** it.

With a free Apple ID the app stops opening after **7 days**. Plug the phone in and press
**Run** in Xcode again to renew it; your settings stay. A paid developer account ($99 a
year) makes that a year.

## Run while developing

```bash
cd mobile
npm install
npx expo run:android      # or: npx expo run:ios --device
```

This builds a development version and starts Metro, so code changes show up instantly.
It can't run in Expo Go, because the app ships its own native ffmpeg.

## Tests

```bash
cd mobile
npm test           # runs the app's ffmpeg arguments through a real ffmpeg
npm run typecheck
```

GitHub Actions (`.github/workflows/mobile.yml`) also builds the Android APKs and the iOS
app, then opens `ffmpegstudio://selftest` in an Android emulator and an iOS simulator.
The self-test makes a clip and an image with ffmpeg and converts them to every format,
so it proves ffmpeg itself works inside the app.

## How it's put together

- `App.tsx`: the one screen.
- `src/core/`: the ffmpeg logic ported from the desktop app: formats, the argument
  builder, ffprobe parsing, defaults and the image target-size search. No React Native
  imports, so `npm test` runs it with plain Node.
- `src/ffmpeg.ts`: runs ffmpeg/ffprobe through
  [ffmpeg-kit-react-native](https://github.com/arthenica/ffmpeg-kit), with progress and
  cancel.
- `src/files.ts`: picking, saving and sharing files.
- `plugins/with-ffmpeg-kit.js` and `native/`: where the ffmpeg binaries come from (below).

### About the ffmpeg binaries

ffmpeg-kit, the standard way to put ffmpeg in a mobile app, was retired in 2025 and its
prebuilt downloads were removed, so a fresh install of it no longer builds. Its code still
works, so this app keeps it and points it at FFmpeg 8.1 builds from
[Anton Karpenko](https://github.com/sk3llo/ffmpeg_kit_flutter), who maintains a fork:

- **Android:** `com.antonkarpenko:ffmpeg-kit-full-gpl` from Maven Central. Its Java classes
  were renamed, so `patches/ffmpeg-kit-react-native+6.0.2.patch` (applied by
  `patch-package` on `npm install`) updates the bridge's imports.
- **iPhone:** the matching full-gpl frameworks from the fork's GitHub release, pinned by
  checksum in `native/ffmpeg-kit-ios-https.podspec`. CocoaPods runs
  `native/ffmpeg-kit-ios-xcframeworks.sh` to repackage them for phones and the simulator.

Both are "full-gpl" builds (they include x264 for H.264), which makes the app GPL-3.0.
That's fine for personal use; keep it in mind before ever publishing it.
