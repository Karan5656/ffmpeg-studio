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
};

// CRF per quality level. Lower CRF = better quality, bigger file.
const CRF = {
  libx264: { high: 20, balanced: 24, small: 29 },
  'libvpx-vp9': { high: 31, balanced: 36, small: 42 },
};

// Audio bitrate (kbps) per quality level.
const AUDIO_KBPS = { high: 192, balanced: 128, small: 96 };

module.exports = { FORMATS, CRF, AUDIO_KBPS };
