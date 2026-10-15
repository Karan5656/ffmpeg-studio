// Output formats the app offers, and how ffmpeg should encode each one.
const FORMATS = {
  mp4: { label: 'MP4 (H.264)', kind: 'video', vcodec: 'libx264', acodec: 'aac' },
  mov: { label: 'MOV (H.264)', kind: 'video', vcodec: 'libx264', acodec: 'aac' },
  mkv: { label: 'MKV (H.264)', kind: 'video', vcodec: 'libx264', acodec: 'aac' },
  webm: { label: 'WebM (VP9)', kind: 'video', vcodec: 'libvpx-vp9', acodec: 'libopus' },
  gif: { label: 'GIF (animated)', kind: 'gif' },
  mp3: { label: 'MP3 audio', kind: 'audio', acodec: 'libmp3lame' },
  m4a: { label: 'M4A audio (AAC)', kind: 'audio', acodec: 'aac' },
  ogg: { label: 'OGG audio (Vorbis)', kind: 'audio', acodec: 'libvorbis' },
  wav: { label: 'WAV audio (lossless)', kind: 'audio', acodec: 'pcm_s16le', lossless: true },
  jpg: { label: 'JPG image', kind: 'image', vcodec: 'mjpeg' },
  png: { label: 'PNG image (lossless)', kind: 'image', vcodec: 'png', lossless: true },
  webp: { label: 'WebP image', kind: 'image', vcodec: 'libwebp' },
};

// CRF per quality level. Lower CRF = better quality, bigger file.
const CRF = {
  libx264: { high: 20, balanced: 24, small: 29 },
  'libvpx-vp9': { high: 31, balanced: 36, small: 42 },
};

// Audio bitrate (kbps) per quality level.
const AUDIO_KBPS = { high: 192, balanced: 128, small: 96 };

// Image quality per level, on a 1-100 scale (100 = best).
const IMAGE_QUALITY = { high: 90, balanced: 75, small: 50 };

module.exports = { FORMATS, CRF, AUDIO_KBPS, IMAGE_QUALITY };
