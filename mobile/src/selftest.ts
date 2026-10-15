import { File, Paths } from 'expo-file-system';

import type { JobOptions } from './core/build-jobs.ts';
import { FORMAT_IDS, FORMATS } from './core/formats.ts';
import { canMake } from './core/media.ts';
import { convert, fileSize, probe, runPasses, uriToPath } from './ffmpeg.ts';
import { workDir } from './files.ts';

/**
 * Generates a short clip and an image with ffmpeg's test sources, then converts them
 * to every format with a few settings. Opened with ffmpegstudio://selftest; CI reads
 * the "SELFTEST" lines from the device log (Android) or Documents/selftest.txt (iOS
 * simulator) to check the ffmpeg build works on a phone.
 */
export async function runSelfTest(log: (line: string) => void) {
  const lines: string[] = [];
  const report = new File(Paths.document, 'selftest.txt');
  const out = (line: string) => {
    console.log(`SELFTEST ${line}`);
    lines.push(line);
    log(line);
    try {
      report.write(lines.join('\n') + '\n');
    } catch {
      // The on-screen list and the log still have it.
    }
  };
  let pass = 0;
  let fail = 0;
  try {
    const dir = uriToPath(workDir().uri).replace(/\/$/, '');
    const clip = `${dir}/self test clip.mp4`;
    const still = `${dir}/self test still.png`;
    await runPasses([{
      label: 'clip',
      args: ['-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440',
        '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip],
    }, {
      label: 'still',
      args: ['-y', '-f', 'lavfi', '-i', 'testsrc=size=800x600', '-frames:v', '1', '-update', '1', still],
    }], 0).promise;

    const cases: { name: string; input: string; opts: Partial<JobOptions> }[] = [];
    const clipInfo = await probe(clip);
    const stillInfo = await probe(still);
    out(`probe clip ${clipInfo.width}x${clipInfo.height} ${clipInfo.duration.toFixed(2)}s video=${clipInfo.hasVideo} audio=${clipInfo.hasAudio}`);
    out(`probe still ${stillInfo.width}x${stillInfo.height} image=${stillInfo.isImage}`);
    for (const id of FORMAT_IDS) {
      const info = FORMATS[id].kind === 'image' ? stillInfo : clipInfo;
      if (!canMake(FORMATS[id], info)) continue;
      cases.push({ name: id, input: FORMATS[id].kind === 'image' ? still : clip, opts: { format: id } });
    }
    cases.push(
      { name: 'mp4 target 0.3MB', input: clip, opts: { format: 'mp4', compression: { mode: 'size', targetMB: 0.3 } } },
      { name: 'mp4 240p trim 1-2s', input: clip, opts: { format: 'mp4', resize: { height: 240 }, trim: { start: 1, end: 2 } } },
      { name: 'mp4 no audio', input: clip, opts: { format: 'mp4', removeAudio: true } },
      { name: 'mp3 target 0.03MB', input: clip, opts: { format: 'mp3', compression: { mode: 'size', targetMB: 0.03 } } },
      { name: 'jpg target 0.02MB', input: still, opts: { format: 'jpg', compression: { mode: 'size', targetMB: 0.02 } } },
      { name: 'webp 50%', input: still, opts: { format: 'webp', resize: { scale: 0.5 } } },
    );

    for (const [i, c] of cases.entries()) {
      const format = c.opts.format!;
      const output = `${dir}/self test ${i}.${format}`;
      const info = FORMATS[format].kind === 'image' ? stillInfo : clipInfo;
      const began = Date.now();
      try {
        await convert({ input: c.input, output, passLogPrefix: `${dir}/selftest2pass`, ...c.opts, format } as JobOptions, info).promise;
        const size = fileSize(output);
        if (!size) throw new Error('empty output');
        const outInfo = await probe(output);
        pass++;
        out(`PASS ${c.name}: ${(size / 1024).toFixed(1)} KB, ${outInfo.width}x${outInfo.height}, ` +
          `${outInfo.duration.toFixed(2)}s, ${((Date.now() - began) / 1000).toFixed(1)}s`);
      } catch (err) {
        fail++;
        out(`FAIL ${c.name}: ${(err as Error).message.replace(/\n/g, ' | ')}`);
      }
    }
  } catch (err) {
    fail++;
    out(`FAIL setup: ${(err as Error).message.replace(/\n/g, ' | ')}`);
  }
  out(`DONE pass=${pass} fail=${fail}`);
}
