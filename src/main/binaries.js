// Paths to the ffmpeg/ffprobe binaries bundled via npm. Inside a packaged app the
// binaries live in app.asar.unpacked, because executables can't run from inside an asar.
const unpacked = (p) => p.replace(`app.asar${require('path').sep}`, `app.asar.unpacked${require('path').sep}`);

const ffmpegPath = unpacked(require('ffmpeg-static'));
const ffprobePath = unpacked(require('ffprobe-static').path);

module.exports = { ffmpegPath, ffprobePath };
