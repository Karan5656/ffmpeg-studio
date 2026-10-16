// Points ffmpeg-kit-react-native at ffmpeg builds that can still be downloaded.
//
// ffmpeg-kit was retired in 2025 and its prebuilt binaries were taken offline, so the
// stock package no longer builds. Its JavaScript and native bridge code still work; only
// the binaries need a new home:
//   Android: com.antonkarpenko:ffmpeg-kit-full-gpl (FFmpeg 8.1) on Maven Central. Its
//            classes live in com.antonkarpenko.ffmpegkit, so
//            patches/ffmpeg-kit-react-native+6.0.2.patch updates the bridge's imports.
//   iOS:     the matching FFmpeg 8.1 full-gpl frameworks from the same maintainer, via
//            native/ffmpeg-kit-ios-https.podspec.
// "full-gpl" includes x264 (H.264), libvpx (VP9), lame (MP3), opus, vorbis and libwebp,
// which the app's formats need.
const { withPodfile, withProjectBuildGradle, withAppBuildGradle } = require('expo/config-plugins');

const ANDROID_FFMPEG = 'com.antonkarpenko:ffmpeg-kit-full-gpl:2.2.3';
const MARK = '// ffmpeg-kit binaries (plugins/with-ffmpeg-kit.js)';

const withAndroidFFmpeg = (config) =>
  withProjectBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(MARK)) {
      cfg.modResults.contents += `
${MARK}
allprojects {
  configurations.all {
    resolutionStrategy.dependencySubstitution {
      substitute module('com.arthenica:ffmpeg-kit-https') using module('${ANDROID_FFMPEG}')
    }
  }
}
`;
    }
    return cfg;
  });

// One APK per CPU type instead of one huge APK: ffmpeg is about 25 MB per architecture.
// arm64-v8a fits every phone from the last several years, armeabi-v7a older ones,
// x86_64 the Android emulator.
const withAbiSplits = (config) =>
  withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(MARK)) {
      cfg.modResults.contents += `
${MARK}
android {
  splits {
    abi {
      enable true
      reset()
      include 'arm64-v8a', 'armeabi-v7a', 'x86_64'
      universalApk false
    }
  }
}
`;
    }
    return cfg;
  });

const withIosFFmpeg = (config) =>
  withPodfile(config, (cfg) => {
    const line = "  pod 'ffmpeg-kit-ios-https', :podspec => File.join(__dir__, '..', 'native', 'ffmpeg-kit-ios-https.podspec')";
    if (!cfg.modResults.contents.includes(line)) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /^(\s*use_expo_modules!.*)$/m,
        `$1\n  # ffmpeg binaries for ffmpeg-kit-react-native (see plugins/with-ffmpeg-kit.js)\n${line}`
      );
    }
    return cfg;
  });

module.exports = (config) => withIosFFmpeg(withAbiSplits(withAndroidFFmpeg(config)));
