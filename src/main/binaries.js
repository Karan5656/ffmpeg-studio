const path = require('path');
const { assertRunnable } = require('../core/binary-arch');

// Paths to the ffmpeg/ffprobe binaries bundled via npm. Inside a packaged app the
// binaries live in app.asar.unpacked, because executables can't run from inside an asar.
const unpacked = (p) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

const ffmpegPath = unpacked(require('ffmpeg-static'));
// @ffprobe-installer ships a native arm64 build for Apple Silicon; ffprobe-static's
// "arm64" macOS binary is really Intel and fails with "spawn Unknown system error -86".
const ffprobePath = unpacked(require('@ffprobe-installer/ffprobe').path);

/** Throws a readable error if either binary can't run on this machine. */
function checkBinaries() {
  assertRunnable('ffmpeg', ffmpegPath);
  assertRunnable('ffprobe', ffprobePath);
}

module.exports = { ffmpegPath, ffprobePath, checkBinaries };
