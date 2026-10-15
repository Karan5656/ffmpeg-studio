// End-to-end: runs the bundled ffmpeg on a generated clip for every format.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const { probe, runPasses } = require('../src/core/ffmpeg');
const { buildJobs } = require('../src/core/build-jobs');
const { FORMATS } = require('../src/core/formats');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-test-'));
const input = path.join(dir, 'sample.mp4');
execFileSync(ffmpegPath, [
  '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=6',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
  '-c:v', 'libx264', '-crf', '18', '-c:a', 'aac', '-shortest', input,
]);
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

async function convert(opts) {
  const info = await probe(ffprobePath, input);
  const { passes, duration } = buildJobs({ input, passLogPrefix: path.join(dir, 'pass'), ...opts }, info);
  const seen = [];
  await runPasses(ffmpegPath, passes, duration, (p) => seen.push(p.fraction)).promise;
  assert.strictEqual(seen.at(-1), 1, 'progress reaches 100%');
  return probe(ffprobePath, opts.output);
}

for (const format of Object.keys(FORMATS)) {
  test(`converts to ${format}`, async () => {
    const out = await convert({ output: path.join(dir, `out.${format}`), format });
    assert.ok(out.size > 0);
    assert.strictEqual(out.hasVideo, FORMATS[format].kind !== 'audio');
  });
}

test('resize + trim', async () => {
  const out = await convert({
    output: path.join(dir, 'small.mp4'), format: 'mp4', resize: { height: 360 }, trim: { start: 1, end: 4 },
  });
  assert.strictEqual(out.height, 360);
  assert.strictEqual(out.width, 640);
  assert.ok(Math.abs(out.duration - 3) < 0.2, `duration ${out.duration}`);
});

test('target size lands near the target', async () => {
  const out = await convert({ output: path.join(dir, 'target.mp4'), format: 'mp4', compression: { mode: 'size', targetMB: 1 } });
  const mb = out.size / 1024 / 1024;
  assert.ok(mb <= 1.05 && mb > 0.6, `got ${mb.toFixed(2)} MB`);
});

test('cancel stops the job', async () => {
  const info = await probe(ffprobePath, input);
  const { passes, duration } = buildJobs({ input, output: path.join(dir, 'c.webm'), format: 'webm' }, info);
  const job = runPasses(ffmpegPath, passes, duration);
  setTimeout(() => job.cancel(), 200);
  await assert.rejects(job.promise, /Cancelled/);
});
