const path = require('path');
const { FORMATS, CRF, AUDIO_KBPS, IMAGE_QUALITY } = require('./formats');

/**
 * Turn the user's settings into the ffmpeg passes needed to produce the output.
 *
 * opts: {
 *   input, output, format,
 *   compression: { mode: 'quality' | 'size', quality: 'high'|'balanced'|'small', targetMB },
 *   resize: { height } or { scale } (fraction, e.g. 0.5); empty = keep original,
 *   trim: { start, end } in seconds (end 0/undefined = until the end),
 *   removeAudio, gifFps,
 *   passLogPrefix: path prefix for two-pass log files
 * }
 * info: result of probe(): { duration, hasVideo, hasAudio, isImage }
 *
 * Returns { passes: [{ label, args }], duration } where duration is the length of the
 * output in seconds, used to compute progress.
 */
function buildJobs(opts, info) {
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

  const inputArgs = [];
  if (start) inputArgs.push('-ss', fmtTime(start));
  inputArgs.push('-i', opts.input);
  if (end && stop === end) inputArgs.push('-t', fmtTime(duration));

  const common = ['-hide_banner', '-y', '-nostats', '-progress', 'pipe:1'];
  const height = Number(opts.resize?.height) || 0;
  const scaleFraction = Number(opts.resize?.scale) || 0;
  const compression = opts.compression || { mode: 'quality', quality: 'balanced' };
  const quality = compression.quality || 'balanced';
  const audioOn = info.hasAudio && !opts.removeAudio;

  if (fmt.kind === 'gif') {
    const fps = Number(opts.gifFps) || 12;
    const scale = height || scaleFraction ? `,${scaleFilter(opts.resize, 2)}:flags=lanczos` : '';
    const filter = `fps=${fps}${scale},split[a][b];[a]palettegen[p];[b][p]paletteuse`;
    return {
      duration,
      passes: [{ label: 'Encoding GIF', args: [...common, ...inputArgs, '-filter_complex', filter, '-an', opts.output] }],
    };
  }

  if (fmt.kind === 'audio') {
    const args = [...common, ...inputArgs, '-vn', '-map', '0:a:0', '-c:a', fmt.acodec];
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
  const videoArgs = ['-map', '0:v:0', '-c:v', fmt.vcodec, '-pix_fmt', 'yuv420p'];
  if (height || scaleFraction) videoArgs.push('-vf', scaleFilter(opts.resize, 2));
  if (fmt.vcodec === 'libx264') videoArgs.push('-preset', 'medium');
  if (fmt.vcodec === 'libvpx-vp9') videoArgs.push('-row-mt', '1', '-deadline', 'good', '-cpu-used', '2');

  const audioKbps = AUDIO_KBPS[quality];
  const audioArgs = audioOn ? ['-map', '0:a:0?', '-c:a', fmt.acodec, '-b:a', `${audioKbps}k`] : ['-an'];
  const containerArgs = fmt.vcodec === 'libx264' && opts.format !== 'mkv' ? ['-movflags', '+faststart'] : [];

  if (compression.mode !== 'size') {
    const crf = CRF[fmt.vcodec][quality];
    const rate = fmt.vcodec === 'libvpx-vp9' ? ['-crf', String(crf), '-b:v', '0'] : ['-crf', String(crf)];
    return {
      duration,
      passes: [{
        label: 'Encoding video',
        args: [...common, ...inputArgs, ...videoArgs, ...rate, ...audioArgs, ...containerArgs, opts.output],
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
  const log = ['-passlogfile', opts.passLogPrefix || path.join(path.dirname(opts.output), 'ffmpeg2pass')];
  const nullOut = process.platform === 'win32' ? 'NUL' : '/dev/null';
  return {
    duration,
    passes: [
      {
        label: 'Analyzing (pass 1 of 2)',
        args: [...common, ...inputArgs, ...videoArgs, ...rate, '-pass', '1', ...log, '-an', '-f', 'null', nullOut],
      },
      {
        label: 'Encoding (pass 2 of 2)',
        args: [...common, ...inputArgs, ...videoArgs, ...rate, '-pass', '2', ...log, ...audioArgs, ...containerArgs, opts.output],
      },
    ],
  };
}

/**
 * Scale filter for a resize setting. `even` = 2 keeps both sides even, which
 * H.264/VP9 need; images can use any size.
 */
function scaleFilter(resize, even = 1) {
  const height = Number(resize?.height) || 0;
  if (height) return `scale=-${even}:${height}`;
  const s = Number(resize?.scale);
  const fit = (side) => (even === 2 ? `trunc(${side}*${s}/2)*2` : `max(1\\,round(${side}*${s}))`);
  return `scale=${fit('iw')}:${fit('ih')}`;
}

/** ffmpeg arguments to write one image at `quality` (1-100, 100 = best). */
function imageArgs(opts, quality) {
  const fmt = FORMATS[opts.format];
  const resize = opts.resize?.height || opts.resize?.scale ? ['-vf', `${scaleFilter(opts.resize)}:flags=lanczos`] : [];
  const q = Math.round(clamp(quality, 1, 100));
  const codec = ['-c:v', fmt.vcodec];
  if (fmt.vcodec === 'mjpeg') {
    // JPEG's qscale runs 2 (best) to 31 (worst). Full-range yuv keeps colors right.
    codec.push('-q:v', String(Math.round(2 + ((100 - q) * 29) / 99)), '-pix_fmt', 'yuvj420p');
  } else if (fmt.vcodec === 'libwebp') {
    codec.push('-quality', String(q));
  } else {
    codec.push('-compression_level', '9'); // PNG: lossless, so squeeze as hard as possible.
  }
  return [
    '-hide_banner', '-y', '-nostats', '-progress', 'pipe:1',
    '-i', opts.input, ...resize, '-frames:v', '1', ...codec, '-update', '1', opts.output,
  ];
}

// Total bitrate in kbps that makes `duration` seconds weigh `targetMB` megabytes.
// Aims 3% under the target to leave room for container overhead.
function bitrateForSize(targetMB, duration) {
  const mb = Number(targetMB);
  if (!(mb > 0)) throw new Error('Enter a target size greater than 0 MB.');
  if (!(duration > 0)) throw new Error('Could not read the file duration, so a target size cannot be used.');
  return Math.floor((mb * 8 * 1024 * 0.97) / duration);
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function fmtTime(seconds) {
  return Number(seconds.toFixed(3)).toString();
}

/** Parse "1:23", "01:02:03.5" or "83.5" into seconds. Empty string -> 0. */
function parseTime(text) {
  const s = String(text ?? '').trim();
  if (!s) return 0;
  const parts = s.split(':');
  if (parts.length > 3 || parts.some((p) => p === '' || isNaN(Number(p)))) {
    throw new Error(`"${s}" is not a valid time. Use seconds or mm:ss or hh:mm:ss.`);
  }
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

/** Pick an output path next to the input that does not overwrite an existing file. */
function defaultOutputPath(input, format, exists) {
  const dir = path.dirname(input);
  const base = path.basename(input, path.extname(input));
  let candidate = path.join(dir, `${base}-studio.${format}`);
  for (let i = 2; exists(candidate); i++) candidate = path.join(dir, `${base}-studio-${i}.${format}`);
  return candidate;
}

module.exports = { buildJobs, imageArgs, bitrateForSize, parseTime, defaultOutputPath };
