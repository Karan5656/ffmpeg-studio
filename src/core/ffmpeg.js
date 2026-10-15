const { spawn, execFile } = require('child_process');

/** Read duration, size and stream info with ffprobe. */
function probe(ffprobePath, file) {
  return new Promise((resolve, reject) => {
    execFile(
      ffprobePath,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
      { maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr.trim() || err.message));
        let data;
        try {
          data = JSON.parse(stdout);
        } catch {
          return reject(new Error('ffprobe returned unreadable output.'));
        }
        const streams = data.streams || [];
        // Cover art in audio files shows up as a video stream; ignore it.
        const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
        const audio = streams.find((s) => s.codec_type === 'audio');
        resolve({
          duration: Number(data.format?.duration) || 0,
          size: Number(data.format?.size) || 0,
          bitrate: Number(data.format?.bit_rate) || 0,
          container: data.format?.format_long_name || data.format?.format_name || '',
          hasVideo: Boolean(video),
          hasAudio: Boolean(audio),
          width: video?.width || 0,
          height: video?.height || 0,
          videoCodec: video?.codec_name || '',
          audioCodec: audio?.codec_name || '',
          fps: video ? parseRate(video.avg_frame_rate || video.r_frame_rate) : 0,
        });
      }
    );
  });
}

function parseRate(rate) {
  const [n, d] = String(rate).split('/').map(Number);
  return d ? Math.round((n / d) * 100) / 100 : n || 0;
}

/**
 * Run the passes one after another. onProgress gets { pass, passCount, label, fraction }
 * where fraction is overall progress 0..1. Returns { promise, cancel }.
 */
function runPasses(ffmpegPath, passes, duration, onProgress) {
  let child = null;
  let cancelled = false;

  const runOne = (pass, index) =>
    new Promise((resolve, reject) => {
      child = spawn(ffmpegPath, pass.args, { windowsHide: true });
      let stderrTail = '';
      let buf = '';
      child.stdout.on('data', (chunk) => {
        buf += chunk.toString();
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          const [key, value] = line.split('=');
          // out_time_us is microseconds despite older builds naming it out_time_ms.
          if ((key === 'out_time_us' || key === 'out_time_ms') && duration > 0) {
            const secs = Number(value) / 1e6;
            if (secs >= 0) report(index, pass.label, Math.min(1, secs / duration));
          } else if (key === 'progress' && value === 'end') {
            report(index, pass.label, 1);
          }
        }
      });
      child.stderr.on('data', (chunk) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-4000);
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (cancelled) return reject(new Error('Cancelled'));
        if (code === 0) return resolve();
        reject(new Error(lastLines(stderrTail) || `ffmpeg exited with code ${code}`));
      });
    });

  const report = (index, label, passFraction) => {
    onProgress?.({
      pass: index + 1,
      passCount: passes.length,
      label,
      fraction: (index + passFraction) / passes.length,
    });
  };

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
      if (child && child.exitCode === null) child.kill('SIGKILL');
    },
  };
}

function lastLines(text, n = 4) {
  return text.trim().split(/\r?\n/).slice(-n).join('\n');
}

module.exports = { probe, runPasses };
