// Output formats the app offers, and how ffmpeg should encode each one.
// Same list as the desktop app (src/core/formats.js on the desktop branch).

export type FormatKind = 'video' | 'gif' | 'audio' | 'image';
export type Quality = 'high' | 'balanced' | 'small';

export interface Format {
  label: string;
  kind: FormatKind;
  vcodec?: string;
  acodec?: string;
  lossless?: boolean;
}

export const FORMATS: Record<string, Format> = {
  mp4: { label: 'MP4', kind: 'video', vcodec: 'libx264', acodec: 'aac' },
  mov: { label: 'MOV', kind: 'video', vcodec: 'libx264', acodec: 'aac' },
  mkv: { label: 'MKV', kind: 'video', vcodec: 'libx264', acodec: 'aac' },
  webm: { label: 'WebM', kind: 'video', vcodec: 'libvpx-vp9', acodec: 'libopus' },
  gif: { label: 'GIF', kind: 'gif' },
  mp3: { label: 'MP3', kind: 'audio', acodec: 'libmp3lame' },
  m4a: { label: 'M4A', kind: 'audio', acodec: 'aac' },
  ogg: { label: 'OGG', kind: 'audio', acodec: 'libvorbis' },
  wav: { label: 'WAV', kind: 'audio', acodec: 'pcm_s16le', lossless: true },
  jpg: { label: 'JPG', kind: 'image', vcodec: 'mjpeg' },
  png: { label: 'PNG', kind: 'image', vcodec: 'png', lossless: true },
  webp: { label: 'WebP', kind: 'image', vcodec: 'libwebp' },
};

export const FORMAT_IDS = Object.keys(FORMATS);

// CRF per quality level. Lower CRF = better quality, bigger file.
export const CRF: Record<string, Record<Quality, number>> = {
  libx264: { high: 20, balanced: 24, small: 29 },
  'libvpx-vp9': { high: 31, balanced: 36, small: 42 },
};

// Audio bitrate (kbps) per quality level.
export const AUDIO_KBPS: Record<Quality, number> = { high: 192, balanced: 128, small: 96 };

// Image quality per level, on a 1-100 scale (100 = best).
export const IMAGE_QUALITY: Record<Quality, number> = { high: 90, balanced: 75, small: 50 };

// MIME types, used when sharing or saving the result.
export const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
