import { AUDIO_KBPS, CRF, FORMATS, IMAGE_QUALITY, type Quality } from './formats.ts';

// Ported from the desktop app's src/core/build-jobs.js. Differences: progress comes
// from FFmpegKit's statistics callback instead of `-progress pipe:1`, and the
// encoder presets are a little faster because phones are slower than desktops.

export interface ProbeInfo {
  isImage: boolean;
  duration: number;
  size: number;
  bitrate: number;
  container: string;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string;
  fps: number;
}

export interface Resize {
  height?: number;
  scale?: number; // fraction, e.g. 0.5
}

export interface JobOptions {
  input: string;
  output: string;
  format: string;
  compression?: { mode: 'quality' | 'size'; quality?: Quality; targetMB?: number };
  resize?: Resize;
  trim?: { start?: number; end?: number }; // seconds; end 0 = until the end
  removeAudio?: boolean;
  gifFps?: number;
  passLogPrefix?: string; // path prefix for two-pass log files
}

export interface Pass {
  label: string;
  args: string[];
}

export interface Jobs {
  passes: Pass[];
  duration: number; // length of the output in seconds, for progress
}

const COMMON = ['-hide_banner', '-y'];

/** Turn the user's settings into the ffmpeg passes needed to produce the output. */
export function buildJobs(opts: JobOptions, info: ProbeInfo): Jobs {
  const fmt = FORMATS[opts.format];
  if (!fmt) throw new Error(`Unknown format: ${opts.format}`);
  if (fmt.kind === 'image' || info.isImage) {
    if (fmt.kind !== 'image') throw new Error('Images can only be converted to an image format.');
    if (!info.isImage) throw new Error('Only image files can be converted to an image format.');
    const quality = IMAGE_QUALITY[opts.compression?.quality || 'balanced'];
    return { duration: 0, passes: [{ label: 'Encoding image', args: imageArgs(opts, quality) }] };
  }
  if (fmt.kind !== 'audio' && !info.hasVideo) {
    throw new Error('This file has no video, so it can only be converted to an audio format.');
  }
  if (fmt.kind === 'audio' && !info.hasAudio) {
    throw new Error('This file has no audio track to extract.');
  }

  const start = Math.max(0, Number(opts.trim?.start) || 0);
  const end = Number(opts.trim?.end) || 0;
  const srcDuration = info.duration || 0;
  if (end && end <= start) throw new Error('Trim end must be after trim start.');
  if (srcDuration && start >= srcDuration) throw new Error('Trim start is past the end of the file.');
  const stop = end && (!srcDuration || end < srcDuration) ? end : srcDuration;
  const duration = stop ? stop - start : 0;

  const inputArgs: string[] = [];
  if (start) inputArgs.push('-ss', fmtTime(start));
  inputArgs.push('-i', opts.input);
  if (end && stop === end) inputArgs.push('-t', fmtTime(duration));

  const height = Number(opts.resize?.height) || 0;
  const scaleFraction = Number(opts.resize?.scale) || 0;
  const compression = opts.compression || { mode: 'quality', quality: 'balanced' };
  const quality: Quality = compression.quality || 'balanced';
  const audioOn = info.hasAudio && !opts.removeAudio;

  if (fmt.kind === 'gif') {
    const fps = Number(opts.gifFps) || 12;
    const scale = height || scaleFraction ? `,${scaleFilter(opts.resize, 2)}:flags=lanczos` : '';
    const filter = `fps=${fps}${scale},split[a][b];[a]palettegen[p];[b][p]paletteuse`;
    return {
      duration,
      passes: [{ label: 'Encoding GIF', args: [...COMMON, ...inputArgs, '-filter_complex', filter, '-an', opts.output] }],
    };
  }

  if (fmt.kind === 'audio') {
    const args = [...COMMON, ...inputArgs, '-vn', '-map', '0:a:0', '-c:a', fmt.acodec!];
    if (!fmt.lossless) {
      const kbps = compression.mode === 'size'
        ? clamp(bitrateForSize(compression.targetMB, duration), 32, 320)
        : AUDIO_KBPS[quality];
      args.push('-b:a', `${kbps}k`);
    }
    args.push(opts.output);
    return { duration, passes: [{ label: 'Encoding audio', args }] };
  }

  // Video formats.
  const vcodec = fmt.vcodec!;
  const videoArgs = ['-map', '0:v:0', '-c:v', vcodec, '-pix_fmt', 'yuv420p'];
  if (height || scaleFraction) videoArgs.push('-vf', scaleFilter(opts.resize, 2));
  if (vcodec === 'libx264') videoArgs.push('-preset', 'faster');
  if (vcodec === 'libvpx-vp9') videoArgs.push('-row-mt', '1', '-deadline', 'good', '-cpu-used', '4');

  const audioKbps = AUDIO_KBPS[quality];
  const audioArgs = audioOn ? ['-map', '0:a:0?', '-c:a', fmt.acodec!, '-b:a', `${audioKbps}k`] : ['-an'];
  const containerArgs = vcodec === 'libx264' && opts.format !== 'mkv' ? ['-movflags', '+faststart'] : [];

  if (compression.mode !== 'size') {
    const crf = CRF[vcodec][quality];
    const rate = vcodec === 'libvpx-vp9' ? ['-crf', String(crf), '-b:v', '0'] : ['-crf', String(crf)];
    return {
      duration,
      passes: [{
        label: 'Encoding video',
        args: [...COMMON, ...inputArgs, ...videoArgs, ...rate, ...audioArgs, ...containerArgs, opts.output],
      }],
    };
  }

  // Target size: two-pass encode at the bitrate that fits the requested size.
  if (!duration) throw new Error('Could not read the file duration, so a target size cannot be used.');
  const totalKbps = bitrateForSize(compression.targetMB, duration);
  const videoKbps = Math.floor(totalKbps - (audioOn ? audioKbps : 0));
  if (videoKbps < 50) {
    throw new Error(
      `${compression.targetMB} MB is too small for ${duration.toFixed(1)}s of video. ` +
      'Try a larger size, trim the clip, or remove the audio.'
    );
  }
  const rate = ['-b:v', `${videoKbps}k`];
  const log = ['-passlogfile', opts.passLogPrefix || `${dirname(opts.output)}/ffmpeg2pass`];
  return {
    duration,
    passes: [
      {
        label: 'Analyzing (pass 1 of 2)',
        args: [...COMMON, ...inputArgs, ...videoArgs, ...rate, '-pass', '1', ...log, '-an', '-f', 'null', '/dev/null'],
      },
      {
        label: 'Encoding (pass 2 of 2)',
        args: [...COMMON, ...inputArgs, ...videoArgs, ...rate, '-pass', '2', ...log, ...audioArgs, ...containerArgs, opts.output],
      },
    ],
  };
}

/**
 * Scale filter for a resize setting. `even` = 2 keeps both sides even, which
 * H.264/VP9 need; images can use any size.
 */
function scaleFilter(resize: Resize | undefined, even = 1): string {
  const height = Number(resize?.height) || 0;
  if (height) return `scale=-${even}:${height}`;
  const s = Number(resize?.scale);
  const fit = (side: string) => (even === 2 ? `trunc(${side}*${s}/2)*2` : `max(1\\,round(${side}*${s}))`);
  return `scale=${fit('iw')}:${fit('ih')}`;
}

/** ffmpeg arguments to write one image at `quality` (1-100, 100 = best). */
export function imageArgs(opts: JobOptions, quality: number): string[] {
  const fmt = FORMATS[opts.format];
  const resize = opts.resize?.height || opts.resize?.scale ? ['-vf', `${scaleFilter(opts.resize)}:flags=lanczos`] : [];
  const q = Math.round(clamp(quality, 1, 100));
  const codec = ['-c:v', fmt.vcodec!];
  if (fmt.vcodec === 'mjpeg') {
    // JPEG's qscale runs 2 (best) to 31 (worst). Full-range yuv keeps colors right.
    codec.push('-q:v', String(Math.round(2 + ((100 - q) * 29) / 99)), '-pix_fmt', 'yuvj420p');
  } else if (fmt.vcodec === 'libwebp') {
    codec.push('-quality', String(q));
  } else {
    codec.push('-compression_level', '9'); // PNG: lossless, so squeeze as hard as possible.
  }
  return [...COMMON, '-i', opts.input, ...resize, '-frames:v', '1', ...codec, '-update', '1', opts.output];
}

// Total bitrate in kbps that makes `duration` seconds weigh `targetMB` megabytes.
// Aims 3% under the target to leave room for container overhead.
export function bitrateForSize(targetMB: number | undefined, duration: number): number {
  const mb = Number(targetMB);
  if (!(mb > 0)) throw new Error('Enter a target size greater than 0 MB.');
  if (!(duration > 0)) throw new Error('Could not read the file duration, so a target size cannot be used.');
  return Math.floor((mb * 8 * 1024 * 0.97) / duration);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function fmtTime(seconds: number): string {
  return Number(seconds.toFixed(3)).toString();
}

function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i > 0 ? p.slice(0, i) : '.';
}

/** Parse "1:23", "01:02:03.5" or "83.5" into seconds. Empty string -> 0. */
export function parseTime(text: string | number | undefined | null): number {
  const s = String(text ?? '').trim();
  if (!s) return 0;
  const parts = s.split(':');
  if (parts.length > 3 || parts.some((p) => p === '' || isNaN(Number(p)))) {
    throw new Error(`"${s}" is not a valid time. Use seconds or mm:ss or hh:mm:ss.`);
  }
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}
