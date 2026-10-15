import { FFmpegKit, FFprobeKit, ReturnCode, type Statistics } from 'ffmpeg-kit-react-native';
import { File } from 'expo-file-system';

import { buildJobs, imageArgs, type JobOptions, type Pass, type ProbeInfo } from './core/build-jobs.ts';
import { bestImageQuality, IMAGE_SEARCH_STEPS } from './core/image-size.ts';
import { FORMATS } from './core/formats.ts';
import { parseProbe } from './core/media.ts';

export interface Progress {
  label: string;
  fraction: number; // overall progress 0..1
}

export interface Job {
  promise: Promise<void>;
  cancel(): void;
}

/** file:///path/to/My%20Clip.mov -> /path/to/My Clip.mov (what ffmpeg wants). */
export function uriToPath(uri: string): string {
  return uri.startsWith('file://') ? decodeURIComponent(uri.slice('file://'.length)) : uri;
}

/** /path/to/My Clip.mov -> an expo-file-system File (the URI needs each part encoded). */
export function fileAt(path: string): File {
  return new File(`file://${path.split('/').map(encodeURIComponent).join('/')}`);
}

export function fileSize(path: string): number {
  const f = fileAt(path);
  return f.exists ? f.size : 0;
}

/** Read duration, size and stream info with ffprobe. */
export async function probe(path: string): Promise<ProbeInfo> {
  const session = await FFprobeKit.getMediaInformation(path);
  const media = session.getMediaInformation();
  if (!media) {
    const out = await session.getOutput();
    throw new Error(lastLines(out) || 'ffprobe could not read this file.');
  }
  const info = parseProbe(media.getAllProperties());
  if (!info.hasVideo && !info.hasAudio) throw new Error('This file has no video, audio or image in it.');
  if (!info.size) info.size = fileSize(path);
  return info;
}

/**
 * Run ffmpeg passes one after another. onProgress gets overall progress across
 * all passes. Returns { promise, cancel }.
 */
export function runPasses(passes: Pass[], duration: number, onProgress?: (p: Progress) => void): Job {
  let sessionId: number | null = null;
  let cancelled = false;

  const report = (index: number, label: string, passFraction: number) =>
    onProgress?.({ label, fraction: (index + passFraction) / passes.length });

  const runOne = (pass: Pass, index: number) =>
    new Promise<void>((resolve, reject) => {
      FFmpegKit.executeWithArgumentsAsync(
        pass.args,
        async (session) => {
          sessionId = null;
          const rc = await session.getReturnCode();
          if (cancelled || ReturnCode.isCancel(rc)) return reject(new Error('Cancelled'));
          if (ReturnCode.isSuccess(rc)) {
            report(index, pass.label, 1);
            return resolve();
          }
          const out = await session.getOutput();
          reject(new Error(lastLines(out) || `ffmpeg failed with code ${rc?.getValue()}`));
        },
        undefined,
        (stats: Statistics) => {
          if (duration > 0) report(index, pass.label, Math.min(1, Math.max(0, stats.getTime() / 1000 / duration)));
        }
      ).then((session) => {
        sessionId = session.getSessionId();
        if (cancelled) FFmpegKit.cancel(sessionId);
      }, reject);
    });

  const promise = (async () => {
    for (let i = 0; i < passes.length; i++) {
      if (cancelled) throw new Error('Cancelled');
      report(i, passes[i].label, 0);
      await runOne(passes[i], i);
    }
  })();

  return {
    promise,
    cancel() {
      cancelled = true;
      if (sessionId !== null) FFmpegKit.cancel(sessionId);
    },
  };
}

/** Convert one file. Handles image target sizes, which need several tries. */
export function convert(opts: JobOptions, info: ProbeInfo, onProgress?: (p: Progress) => void): Job {
  const imageToSize = FORMATS[opts.format]?.kind === 'image' && opts.compression?.mode === 'size'
    && !FORMATS[opts.format].lossless;
  if (!imageToSize) {
    const { passes, duration } = buildJobs(opts, info);
    return runPasses(passes, duration, onProgress);
  }

  let current: Job | null = null;
  let cancelled = false;
  const ext = opts.output.slice(opts.output.lastIndexOf('.'));
  const tryPath = (q: number) => `${opts.output.slice(0, -ext.length)}.try-${q}${ext}`;
  const tried = new Set<number>();
  const label = 'Finding the best quality';

  const promise = (async () => {
    try {
      const limit = Number(opts.compression?.targetMB) * 1024 * 1024;
      const best = await bestImageQuality(limit, async (q, step) => {
        if (cancelled) throw new Error('Cancelled');
        onProgress?.({ label, fraction: step / IMAGE_SEARCH_STEPS });
        tried.add(q);
        current = runPasses([{ label, args: imageArgs({ ...opts, output: tryPath(q) }, q) }], 0);
        await current.promise;
        return fileSize(tryPath(q));
      });
      await fileAt(tryPath(best)).move(fileAt(opts.output), { overwrite: true });
      tried.delete(best);
      onProgress?.({ label, fraction: 1 });
    } finally {
      for (const q of tried) {
        const f = fileAt(tryPath(q));
        if (f.exists) f.delete();
      }
    }
  })();

  return {
    promise,
    cancel() {
      cancelled = true;
      current?.cancel();
    },
  };
}

function lastLines(text: string | undefined, n = 4): string {
  return (text || '').trim().split(/\r?\n/).slice(-n).join('\n');
}
