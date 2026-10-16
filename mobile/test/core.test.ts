/// <reference types="node" />
// Checks the ffmpeg arguments the app builds by running them through a real ffmpeg
// (ffmpeg-static) on a generated clip and image. Run with `npm test`.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { buildJobs, bitrateForSize, parseTime, type JobOptions } from '../src/core/build-jobs.ts';
import { FORMATS, FORMAT_IDS } from '../src/core/formats.ts';
import { bestImageQuality } from '../src/core/image-size.ts';
import { canMake, outputName, parseProbe, sameFormat, sizeChoices } from '../src/core/media.ts';
import { imageArgs } from '../src/core/build-jobs.ts';

const require = createRequire(import.meta.url);
const ffmpeg: string = require('ffmpeg-static');
const ffprobe: string = require('ffprobe-static').path;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-mobile-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const clip = path.join(dir, 'sample clip.mp4');
execFileSync(ffmpeg, [
  '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=6',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
  '-c:v', 'libx264', '-crf', '18', '-c:a', 'aac', '-shortest', clip,
]);
const photo = path.join(dir, 'photo.png');
execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=2000x1500', '-frames:v', '1', photo]);

function probe(file: string) {
  const json = execFileSync(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  return parseProbe(JSON.parse(json.toString()));
}

function run(opts: JobOptions) {
  const { passes } = buildJobs({ passLogPrefix: path.join(dir, 'pass'), ...opts }, probe(opts.input));
  for (const p of passes) execFileSync(ffmpeg, ['-v', 'error', ...p.args]);
  return probe(opts.output);
}

for (const format of FORMAT_IDS.filter((f) => FORMATS[f].kind !== 'image')) {
  test(`converts video to ${format}`, () => {
    const out = run({ input: clip, output: path.join(dir, `out.${format}`), format });
    assert.ok(out.size > 0);
    assert.strictEqual(out.hasVideo, FORMATS[format].kind !== 'audio');
  });
}

test('resize + trim', () => {
  const out = run({
    input: clip, output: path.join(dir, 'small.mp4'), format: 'mp4', resize: { height: 360 }, trim: { start: 1, end: 4 },
  });
  assert.deepStrictEqual([out.width, out.height], [640, 360]);
  assert.ok(Math.abs(out.duration - 3) < 0.2, `duration ${out.duration}`);
});

test('target size lands near the target', () => {
  const out = run({ input: clip, output: path.join(dir, 'target.mp4'), format: 'mp4', compression: { mode: 'size', targetMB: 1 } });
  const mb = out.size / 1024 / 1024;
  assert.ok(mb <= 1.05 && mb > 0.6, `got ${mb.toFixed(2)} MB`);
});

test('remove audio', () => {
  const out = run({ input: clip, output: path.join(dir, 'mute.mp4'), format: 'mp4', removeAudio: true });
  assert.strictEqual(out.hasAudio, false);
});

test('detects images', () => {
  assert.strictEqual(probe(photo).isImage, true);
  assert.strictEqual(probe(clip).isImage, false);
});

for (const format of ['jpg', 'png', 'webp']) {
  test(`converts image to ${format} with resize`, () => {
    const out = run({ input: photo, output: path.join(dir, `photo-out.${format}`), format, resize: { scale: 0.5 } });
    assert.strictEqual(out.isImage, true);
    assert.deepStrictEqual([out.width, out.height], [1000, 750]);
  });
}

test('image target size picks the best quality that fits', async () => {
  const limit = 150 * 1024;
  const q = await bestImageQuality(limit, async (quality) => {
    const output = path.join(dir, `try-${quality}.jpg`);
    execFileSync(ffmpeg, ['-v', 'error', ...imageArgs({ input: photo, output, format: 'jpg' }, quality)]);
    return fs.statSync(output).size;
  });
  assert.ok(fs.statSync(path.join(dir, `try-${q}.jpg`)).size <= limit);
  assert.ok(q > 1 && q < 100, `quality ${q}`);
});

test('image target size explains when nothing fits', async () => {
  await assert.rejects(bestImageQuality(10, async () => 5000), /Even the lowest quality/);
});

test('defaults match the picked file', () => {
  const video = probe(clip);
  assert.strictEqual(sameFormat('holiday.MOV', video), 'mov');
  assert.strictEqual(sameFormat('clip.m4v', video), 'mp4');
  assert.strictEqual(sameFormat('clip.avi', video), 'mp4');
  assert.strictEqual(sameFormat('IMG_1.HEIC', probe(photo)), 'png');
  assert.strictEqual(sameFormat('photo.jpeg', probe(photo)), 'jpg');
  assert.deepStrictEqual(sizeChoices(video).map((s) => s.id), ['0', '480', '360', '240']);
  assert.deepStrictEqual(sizeChoices(probe(photo)).map((s) => s.id), ['0', 'scale:0.75', 'scale:0.5', 'scale:0.25']);
  assert.ok(!canMake(FORMATS.jpg, video));
  assert.strictEqual(outputName('My Clip.final.mov', 'mp4'), 'My Clip.final-studio.mp4');
});

test('rejects bad settings', () => {
  const video = probe(clip);
  const base = { input: clip, output: path.join(dir, 'x.mp4'), format: 'mp4' };
  assert.throws(() => buildJobs({ ...base, trim: { start: 4, end: 2 } }, video), /after trim start/);
  assert.throws(() => buildJobs({ ...base, trim: { start: 60 } }, video), /past the end/);
  assert.throws(() => buildJobs({ ...base, compression: { mode: 'size', targetMB: 0.01 } }, video), /too small/);
  assert.throws(() => buildJobs({ ...base, format: 'jpg' }, video), /image/);
  assert.throws(() => bitrateForSize(0, 10), /greater than 0/);
});

test('parseTime', () => {
  assert.strictEqual(parseTime('75'), 75);
  assert.strictEqual(parseTime('1:15'), 75);
  assert.strictEqual(parseTime('0:01:15.5'), 75.5);
  assert.strictEqual(parseTime(''), 0);
  assert.throws(() => parseTime('1:x'), /not a valid time/);
});
