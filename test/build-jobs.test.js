const test = require('node:test');
const assert = require('node:assert');
const { buildJobs, bitrateForSize, parseTime, defaultOutputPath } = require('../src/core/build-jobs');

const video = { duration: 60, hasVideo: true, hasAudio: true };
const base = { input: 'in.mov', output: 'out.mp4', format: 'mp4' };

test('parseTime accepts seconds, mm:ss and hh:mm:ss', () => {
  assert.strictEqual(parseTime(''), 0);
  assert.strictEqual(parseTime('12.5'), 12.5);
  assert.strictEqual(parseTime('1:30'), 90);
  assert.strictEqual(parseTime('01:02:03'), 3723);
  assert.throws(() => parseTime('abc'));
  assert.throws(() => parseTime('1::2'));
});

test('quality mode is a single CRF pass', () => {
  const { passes } = buildJobs({ ...base, compression: { mode: 'quality', quality: 'small' } }, video);
  assert.strictEqual(passes.length, 1);
  const a = passes[0].args;
  assert.strictEqual(a[a.indexOf('-crf') + 1], '29');
  assert.strictEqual(a.at(-1), 'out.mp4');
});

test('target size uses two passes with a bitrate that fits', () => {
  const { passes } = buildJobs({ ...base, compression: { mode: 'size', targetMB: 10 } }, video);
  assert.strictEqual(passes.length, 2);
  const kbps = parseInt(passes[1].args[passes[1].args.indexOf('-b:v') + 1], 10);
  assert.strictEqual(kbps, bitrateForSize(10, 60) - 128);
  assert.ok(passes[0].args.includes('null'));
});

test('target size that is too small is rejected', () => {
  assert.throws(() => buildJobs({ ...base, compression: { mode: 'size', targetMB: 0.1 } }, video), /too small/);
});

test('trim and resize', () => {
  const { passes, duration } = buildJobs({ ...base, trim: { start: 10, end: 25 }, resize: { height: 720 } }, video);
  const a = passes[0].args;
  assert.strictEqual(duration, 15);
  assert.strictEqual(a[a.indexOf('-ss') + 1], '10');
  assert.strictEqual(a[a.indexOf('-t') + 1], '15');
  assert.strictEqual(a[a.indexOf('-vf') + 1], 'scale=-2:720');
});

test('trim end past the file length is clamped', () => {
  const { duration, passes } = buildJobs({ ...base, trim: { start: 50, end: 500 } }, video);
  assert.strictEqual(duration, 10);
  assert.ok(!passes[0].args.includes('-t'));
});

test('bad trims are rejected', () => {
  assert.throws(() => buildJobs({ ...base, trim: { start: 20, end: 10 } }, video), /after/);
  assert.throws(() => buildJobs({ ...base, trim: { start: 90 } }, video), /past the end/);
});

test('audio formats drop video; video formats need a video stream', () => {
  const { passes } = buildJobs({ ...base, output: 'o.mp3', format: 'mp3' }, video);
  assert.ok(passes[0].args.includes('-vn'));
  assert.throws(() => buildJobs(base, { duration: 10, hasVideo: false, hasAudio: true }), /no video/);
});

test('remove audio', () => {
  const { passes } = buildJobs({ ...base, removeAudio: true }, video);
  assert.ok(passes[0].args.includes('-an'));
});

test('defaultOutputPath never overwrites', () => {
  const taken = new Set(['/v/clip-studio.mp4', '/v/clip-studio-2.mp4']);
  assert.strictEqual(defaultOutputPath('/v/clip.mov', 'mp4', (p) => taken.has(p)), '/v/clip-studio-3.mp4');
});
