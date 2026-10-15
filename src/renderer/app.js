const $ = (id) => document.getElementById(id);
const api = window.studio;

const state = { input: null, info: null, output: null, outputChosen: false, formats: [], running: false };

function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function formatDuration(s) {
  if (!s) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function currentFormat() {
  return state.formats.find((f) => f.id === $('format').value);
}

function mode() {
  return document.querySelector('input[name=mode]:checked').value;
}

function showError(msg) {
  $('error').textContent = msg;
  $('error').hidden = !msg;
}

// Show only the controls that apply to the chosen format.
function refreshControls() {
  const fmt = currentFormat();
  if (!fmt) return;
  const isAudio = fmt.kind === 'audio';
  const isGif = fmt.kind === 'gif';
  const lossless = fmt.id === 'wav';

  $('gif-fps-row').hidden = !isGif;
  $('remove-audio-row').hidden = isAudio || isGif;
  $('resize-card').classList.toggle('disabled', isAudio);
  $('compress-card').classList.toggle('disabled', isGif || lossless);
  $('lossless-note').hidden = !lossless;
  $('quality-row').hidden = mode() !== 'quality';
  $('size-row').hidden = mode() !== 'size';
  $('custom-height-row').hidden = $('height').value !== 'custom';
  updateSizeHint();
}

function updateSizeHint() {
  const info = state.info;
  if (!info || mode() !== 'size') return ($('size-hint').textContent = '');
  const mb = Number($('target-mb').value);
  const original = info.size / 1024 / 1024;
  $('size-hint').textContent = mb > 0
    ? `Original is ${original.toFixed(1)} MB (${Math.round((mb / original) * 100)}% of it).`
    : '';
}

async function loadFile(file) {
  showError('');
  $('result').hidden = true;
  try {
    const info = await api.probe(file);
    state.input = file;
    state.info = info;
    state.outputChosen = false;

    const parts = [formatBytes(info.size), formatDuration(info.duration)];
    if (info.hasVideo) parts.push(`${info.width}×${info.height}`, `${info.videoCodec}`, info.fps ? `${info.fps} fps` : '');
    if (info.hasAudio) parts.push(`audio: ${info.audioCodec}`);
    $('file-name').textContent = file.split(/[\\/]/).pop();
    $('file-meta').textContent = parts.filter(Boolean).join(' · ');
    $('drop-empty').hidden = true;
    $('file-info').hidden = false;

    // Audio-only input can only become audio.
    if (!info.hasVideo && currentFormat().kind !== 'audio') $('format').value = 'mp3';
    for (const opt of $('format').options) {
      const f = state.formats.find((x) => x.id === opt.value);
      opt.disabled = (!info.hasVideo && f.kind !== 'audio') || (!info.hasAudio && f.kind === 'audio');
    }
    if (info.size) $('target-mb').value = Math.max(0.1, Math.round((info.size / 1024 / 1024) * 5) / 10);

    $('convert').disabled = false;
    $('change-output').disabled = false;
    await refreshOutput();
    refreshControls();
  } catch (err) {
    showError(`Couldn't read that file: ${err.message}`);
  }
}

async function refreshOutput() {
  if (!state.input) return;
  const fmt = $('format').value;
  if (state.outputChosen && state.output) {
    // Keep the user's chosen folder and name, just swap the extension.
    state.output = state.output.replace(/\.[^./\\]+$/, '') + '.' + fmt;
  } else {
    state.output = await api.defaultOutput(state.input, fmt);
  }
  $('output-path').textContent = state.output;
}

function setRunning(running) {
  state.running = running;
  $('convert').hidden = running;
  $('cancel').hidden = !running;
  $('progress-wrap').hidden = !running;
  for (const el of document.querySelectorAll('select, input, #pick, #change, #change-output')) el.disabled = running;
}

async function convert() {
  showError('');
  $('result').hidden = true;
  const height = $('height').value === 'custom' ? Number($('custom-height').value) : Number($('height').value);
  const opts = {
    input: state.input,
    output: state.output,
    format: $('format').value,
    compression: { mode: mode(), quality: $('quality').value, targetMB: Number($('target-mb').value) },
    resize: { height },
    trim: { start: $('trim-start').value, end: $('trim-end').value },
    removeAudio: $('remove-audio').checked,
    gifFps: Number($('gif-fps').value),
  };

  $('bar').style.width = '0%';
  $('progress-label').textContent = 'Starting…';
  setRunning(true);
  try {
    const res = await api.convert(opts);
    const before = state.info.size;
    const change = before ? Math.round((1 - res.size / before) * 100) : 0;
    const changeText = change >= 0 ? `${change}% smaller` : `${-change}% larger`;
    $('result').innerHTML = '';
    $('result').append(
      `Done in ${res.seconds.toFixed(1)}s. ${formatBytes(res.size)} (${changeText} than the original).`
    );
    const reveal = document.createElement('button');
    reveal.textContent = 'Show in folder';
    reveal.onclick = () => api.reveal(res.output);
    $('result').append(reveal);
    $('result').hidden = false;
    state.outputChosen = false;
  } catch (err) {
    if (err.message !== 'Cancelled') showError(err.message);
  } finally {
    setRunning(false);
    await refreshOutput();
  }
}

api.onProgress((p) => {
  const pct = Math.round(p.fraction * 100);
  $('bar').style.width = `${pct}%`;
  $('progress-label').textContent = `${p.label} · ${pct}%`;
});

async function init() {
  state.formats = await api.formats();
  for (const f of state.formats) $('format').add(new Option(f.label, f.id));
  $('format').value = 'mp4';
  refreshControls();

  const pick = async () => {
    const file = await api.pickFile();
    if (file) loadFile(file);
  };
  $('pick').onclick = pick;
  $('change').onclick = pick;

  const drop = $('drop');
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const file = e.dataTransfer.files[0];
    if (file && !state.running) loadFile(api.pathForFile(file));
  });

  $('format').onchange = () => { refreshOutput(); refreshControls(); };
  $('height').onchange = refreshControls;
  $('target-mb').oninput = updateSizeHint;
  for (const r of document.querySelectorAll('input[name=mode]')) r.onchange = refreshControls;

  $('change-output').onclick = async () => {
    const chosen = await api.pickOutput(state.output, $('format').value);
    if (chosen) {
      state.output = chosen;
      state.outputChosen = true;
      $('output-path').textContent = chosen;
    }
  };
  $('convert').onclick = convert;
  $('cancel').onclick = () => api.cancel();
}

init();
