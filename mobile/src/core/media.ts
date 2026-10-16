import { FORMATS, type Format } from './formats.ts';
import type { ProbeInfo } from './build-jobs.ts';

/** Turn ffprobe's JSON (`-show_format -show_streams`) into the fields the app uses. */
export function parseProbe(data: { format?: any; streams?: any[] } | undefined | null): ProbeInfo {
  const streams = data?.streams || [];
  // Cover art in audio files shows up as a video stream; ignore it.
  const video = streams.find((s) => s.codec_type === 'video' && !Number(s.disposition?.attached_pic));
  const audio = streams.find((s) => s.codec_type === 'audio');
  const formatName: string = data?.format?.format_name || '';
  return {
    // Still images come through ffmpeg's image demuxers (image2, png_pipe, jpeg_pipe, ...).
    isImage: Boolean(video) && !audio && (formatName === 'image2' || formatName.endsWith('_pipe')),
    duration: Number(data?.format?.duration) || 0,
    size: Number(data?.format?.size) || 0,
    bitrate: Number(data?.format?.bit_rate) || 0,
    container: data?.format?.format_long_name || formatName,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    width: Number(video?.width) || 0,
    height: Number(video?.height) || 0,
    videoCodec: video?.codec_name || '',
    audioCodec: audio?.codec_name || '',
    fps: video ? parseRate(video.avg_frame_rate || video.r_frame_rate) : 0,
  };
}

function parseRate(rate: string): number {
  const [n, d] = String(rate).split('/').map(Number);
  return d ? Math.round((n / d) * 100) / 100 : n || 0;
}

/** Whether a file with this probe info can be converted to fmt. */
export function canMake(fmt: Format, info: ProbeInfo): boolean {
  if (info.isImage) return fmt.kind === 'image';
  if (fmt.kind === 'image') return false;
  return fmt.kind === 'audio' ? info.hasAudio : info.hasVideo;
}

// Other extensions that are really one of our formats.
const FORMAT_ALIASES: Record<string, string> = { m4v: 'mp4', aac: 'm4a', oga: 'ogg', jpeg: 'jpg', qt: 'mov' };

/** The output format matching the input file, or the closest sensible one. */
export function sameFormat(fileName: string, info: ProbeInfo): string {
  const ext = (fileName.match(/\.([^./\\]+)$/)?.[1] || '').toLowerCase();
  const id = FORMAT_ALIASES[ext] || ext;
  if (FORMATS[id] && canMake(FORMATS[id], info)) return id;
  if (info.isImage) return 'png';
  return info.hasVideo ? 'mp4' : 'mp3';
}

export interface SizeChoice {
  id: string; // '0' = original, '720' = height, 'scale:0.5' = fraction
  label: string;
}

const VIDEO_HEIGHTS = [2160, 1440, 1080, 720, 480, 360, 240];
const IMAGE_SCALES = [0.75, 0.5, 0.25];

/** Resolution choices: preset heights below the source for video, percentages for images. */
export function sizeChoices(info: ProbeInfo): SizeChoice[] {
  const original: SizeChoice = { id: '0', label: info.width ? `Original ${info.width}×${info.height}` : 'Original' };
  if (info.isImage) {
    return [original, ...IMAGE_SCALES.map((s) => ({
      id: `scale:${s}`,
      label: `${s * 100}% ${Math.round(info.width * s)}×${Math.round(info.height * s)}`,
    }))];
  }
  // Only offer sizes smaller than the source; upscaling just makes files bigger.
  const shorter = info.height || Infinity;
  return [original, ...VIDEO_HEIGHTS.filter((h) => h < shorter).map((h) => ({ id: String(h), label: `${h}p` }))];
}

export function resizeFromChoice(id: string): { height?: number; scale?: number } {
  if (id.startsWith('scale:')) return { scale: Number(id.slice(6)) };
  const height = Number(id);
  return height ? { height } : {};
}

export function formatBytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function formatDuration(s: number): string {
  if (!s) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Megabytes, rounded so small files still get a meaningful number. */
export function toMB(bytes: number): number {
  const mb = bytes / 1024 / 1024;
  return Math.max(0.01, Number(mb.toFixed(mb < 10 ? 2 : 1)));
}

/** `holiday.MOV` + `mp4` -> `holiday-studio.mp4` */
export function outputName(inputName: string, format: string): string {
  const base = inputName.replace(/\.[^.]+$/, '') || 'file';
  return `${base}-studio.${format}`;
}
