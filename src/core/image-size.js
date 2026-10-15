const fs = require('fs');
const path = require('path');
const { imageArgs } = require('./build-jobs');
const { runPasses } = require('./ffmpeg');

const STEPS = 7; // binary search over quality 1-100 settles within 7 tries

/**
 * Images have no bitrate to aim for, so find the best quality that fits under
 * targetMB by encoding a few times. Each try goes to a temp file next to the output;
 * the best fit is renamed into place. Returns { promise, cancel } like runPasses.
 */
function encodeImageToSize(ffmpegPath, opts, onProgress) {
  const limit = Number(opts.compression?.targetMB) * 1024 * 1024;
  const ext = path.extname(opts.output);
  const tryPath = (q) => path.join(path.dirname(opts.output), `.studio-try-${process.pid}-${q}${ext}`);
  let job = null;
  let cancelled = false;
  const tried = new Map(); // quality -> size

  const encode = async (q, step) => {
    if (cancelled) throw new Error('Cancelled');
    const out = tryPath(q);
    job = runPasses(ffmpegPath, [{ label: 'Finding the best quality', args: imageArgs({ ...opts, output: out }, q) }], 0);
    onProgress?.({ pass: step + 1, passCount: STEPS, label: 'Finding the best quality', fraction: step / STEPS });
    await job.promise;
    const size = fs.statSync(out).size;
    tried.set(q, size);
    return size;
  };

  const promise = (async () => {
    if (!(limit > 0)) throw new Error('Enter a target size greater than 0 MB.');
    try {
      let lo = 1;
      let hi = 100;
      let best = null;
      for (let step = 0; step < STEPS && lo <= hi; step++) {
        const q = Math.floor((lo + hi) / 2);
        if ((await encode(q, step)) <= limit) {
          best = q;
          lo = q + 1;
        } else {
          hi = q - 1;
        }
      }
      if (best === null && (tried.has(1) ? tried.get(1) : await encode(1, STEPS - 1)) <= limit) best = 1;
      if (best === null) {
        throw new Error(
          `Even the lowest quality is ${(tried.get(1) / 1024 / 1024).toFixed(2)} MB. ` +
            'Make the image smaller with Resolution, or pick a larger target.'
        );
      }
      fs.renameSync(tryPath(best), opts.output);
      onProgress?.({ pass: STEPS, passCount: STEPS, label: 'Finding the best quality', fraction: 1 });
    } finally {
      for (const q of tried.keys()) fs.rmSync(tryPath(q), { force: true });
    }
  })();

  return {
    promise,
    cancel() {
      cancelled = true;
      job?.cancel();
    },
  };
}

module.exports = { encodeImageToSize };
