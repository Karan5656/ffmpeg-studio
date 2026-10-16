#!/bin/bash
# Run by CocoaPods (prepare_command in ffmpeg-kit-ios-https.podspec) inside the unzipped
# FFmpeg release, which holds fat .frameworks with x86_64, arm64 and arm64e slices.
# A fat framework can't hold arm64 for both the device and the simulator, so each one
# becomes an .xcframework:
#   ios-arm64                   the device slice (arm64e dropped; apps run as arm64)
#   ios-arm64_x86_64-simulator  x86_64, plus the arm64 slice re-tagged as simulator,
#                               which Apple Silicon Macs need
set -euo pipefail

mkdir -p xcframeworks
for fw in ffmpegkit libavcodec libavdevice libavfilter libavformat libavutil libswresample libswscale; do
  bin="$fw.framework/$fw"
  [ -f "$bin" ] || { echo "ffmpeg-kit-ios-https: $fw.framework is missing from the download" >&2; exit 1; }
  xcrun bitcode_strip -r "$bin" -o "$bin"
  minos=$(otool -l -arch arm64 "$bin" | awk '/LC_BUILD_VERSION/{b=1} b&&/minos/{print $2; exit}')
  sdk=$(otool -l -arch arm64 "$bin" | awk '/LC_BUILD_VERSION/{b=1} b&&/sdk/{print $2; exit}')
  work="build/$fw"
  rm -rf "$work"
  mkdir -p "$work/device" "$work/sim"
  cp -R "$fw.framework" "$work/device/"
  cp -R "$fw.framework" "$work/sim/"

  lipo "$bin" -thin arm64 -output "$work/device/$fw.framework/$fw"

  lipo "$bin" -thin x86_64 -output "$work/x86_64"
  lipo "$bin" -thin arm64 -output "$work/arm64"
  vtool -arch arm64 -set-build-version 7 "${minos:-14.0}" "${sdk:-${minos:-14.0}}" -replace \
    -output "$work/arm64-sim" "$work/arm64"
  lipo -create "$work/x86_64" "$work/arm64-sim" -output "$work/sim/$fw.framework/$fw"

  rm -rf "xcframeworks/$fw.xcframework"
  xcodebuild -create-xcframework -framework "$work/device/$fw.framework" \
    -framework "$work/sim/$fw.framework" -output "xcframeworks/$fw.xcframework" >/dev/null
  rm -rf "$fw.framework"
done
rm -rf build
