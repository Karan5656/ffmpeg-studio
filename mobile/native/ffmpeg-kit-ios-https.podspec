# The iOS ffmpeg binaries for ffmpeg-kit-react-native (see plugins/with-ffmpeg-kit.js).
#
# ffmpeg-kit-react-native asks for a pod called ffmpeg-kit-ios-https 6.0, whose downloads
# were taken offline in 2025. This podspec answers to that name but ships the FFmpeg 8.1
# full-gpl build maintained by Anton Karpenko (sk3llo/ffmpeg_kit_flutter), the same
# maintainer as the Android build. It has x264, x265, libvpx, lame, opus, vorbis and
# libwebp, and keeps the ffmpeg-kit 6.0 Objective-C API the bridge calls.
#
# The release zip holds fat .frameworks; ffmpeg-kit-ios-xcframeworks.sh splits them
# into .xcframeworks with a device slice and an arm64 + x86_64 simulator slice.
Pod::Spec.new do |s|
  s.name         = 'ffmpeg-kit-ios-https'
  s.version      = '6.0'
  s.summary      = 'FFmpeg 8.1 full-gpl frameworks for ffmpeg-kit-react-native'
  s.homepage     = 'https://github.com/sk3llo/ffmpeg_kit_flutter'
  s.license      = { :type => 'GPL-3.0' }
  s.authors      = { 'Anton Karpenko' => 'kapraton@gmail.com' }
  s.source       = {
    :http => 'https://github.com/sk3llo/ffmpeg_kit_flutter/releases/download/8.1.2-full-gpl/ffmpeg-kit-ios-full-gpl-8.1.2.zip',
    :sha256 => 'bacd4c69faa8264bd1803c68d6d61938173b65413b5e70951f320211128354e2',
  }
  s.platform     = :ios, '15.0'
  s.prepare_command = File.read(File.join(__dir__, 'ffmpeg-kit-ios-xcframeworks.sh'))

  libs = %w[ffmpegkit libavcodec libavdevice libavfilter libavformat libavutil libswresample libswscale]
  s.vendored_frameworks = libs.map { |lib| "xcframeworks/#{lib}.xcframework" }
  s.preserve_paths      = 'xcframeworks/**/*'
  s.frameworks          = 'AudioToolbox', 'AVFoundation', 'CoreMedia', 'VideoToolbox'
  s.libraries           = 'z', 'bz2', 'c++', 'iconv'
  s.pod_target_xcconfig = { 'ENABLE_BITCODE' => 'NO', 'DEFINES_MODULE' => 'YES' }
end
