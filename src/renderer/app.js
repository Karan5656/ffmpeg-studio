const $ = (id) => document.getElementById(id);
const api = window.studio;

const state = {
  input: null,
  info: null,
  output: null,
  outputChosen: false,
  formats: [],
  format: 'mp4',
  sizeMode: 'balanced', // 'high' | 'balanced' | 'small' | 'size'
  running: false,
};

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

const baseName = (p) => p.split(/[\\/]/).pop();
const currentFormat = () => state.formats.find((f) => f.id === state.format);

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

  for (const b of document.querySelectorAll('.pill')) b.classList.toggle('on', b.dataset.value === state.format);
  for (const b of $('size-mode').children) b.classList.toggle('on', b.dataset.value === state.sizeMode);

  $('size-mode').classList.toggle('disabled', isGif || lossless);
  $('lossless-note').hidden = !lossless;
  $('gif-note').hidden = !isGif;
  $('size-row').hidden = state.sizeMode !== 'size' || isGif || lossless;
  $('resize-field').classList.toggle('disabled', isAudio);
  $('custom-height-row').hidden = $('height').value !== 'custom';
  $('remove-audio-row').hidden = isAudio || isGif;
  $('gif-fps-row').hidden = !isGif;
  $('extras-section').hidden = isAudio;
  updateSizeHint();
}

function updateSizeHint() {
  const info = state.info;
  const mb = Number($('target-mb').value);
  if (!info?.size || !(mb > 0)) return ($('size-hint').textContent = '');
  const original = info.size / 1024 / 1024;
  $('size-hint').textContent = `of ${original.toFixed(1)} MB original (${Math.round((mb / original) * 100)}%)`;
}

async function loadFile(file) {
  try {
    const info = await api.probe(file);
    state.input = file;
    state.info = info;
    state.outputChosen = false;

    $('file-name').textContent = baseName(file);
    const chips = [formatBytes(info.size), formatDuration(info.duration)];
    if (info.hasVideo) chips.push(`${info.width}×${info.height}`, info.videoCodec, info.fps ? `${info.fps} fps` : '');
    if (info.hasAudio) chips.push(`${info.audioCodec} audio`);
    $('file-meta').replaceChildren(
      ...chips.filter(Boolean).map((t) => Object.assign(document.createElement('span'), { className: 'chip', textContent: t }))
    );

    // Only offer formats this file can actually become.
    for (const b of document.querySelectorAll('.pill')) {
      const f = state.formats.find((x) => x.id === b.dataset.value);
      b.disabled = (!info.hasVideo && f.kind !== 'audio') || (!info.hasAudio && f.kind === 'audio');
    }
    if (!info.hasVideo && currentFormat().kind !== 'audio') state.format = 'mp3';
    if (info.size) $('target-mb').value = Math.max(0.1, Math.round((info.size / 1024 / 1024) * 5) / 10);

    $('empty').hidden = true;
    $('editor').hidden = false;
    $('empty-error').hidden = true;
    $('result').hidden = true;
    showError('');
    await refreshOutput();
    refreshControls();
  } catch (err) {
    const msg = `Couldn't read that file: ${err.message}`;
    if (state.input) showError(msg);
    else Object.assign($('empty-error'), { textContent: msg, hidden: false });
  }
}

async function refreshOutput() {
  if (!state.input) return;
  if (state.outputChosen && state.output) {
    // Keep the user's chosen folder and name, just swap the extension.
    state.output = state.output.replace(/\.[^./\\]+$/, '') + '.' + state.format;
  } else {
    state.output = await api.defaultOutput(state.input, state.format);
  }
  showOutput();
}

function showOutput() {
  $('change-output').textContent = baseName(state.output);
  $('change-output').title = `${state.output}\nClick to change`;
}

function setRunning(running) {
  state.running = running;
  $('convert').hidden = running;
  $('cancel').hidden = !running;
  $('progress-wrap').hidden = !running;
  $('change-output').parentElement.hidden = running;
  for (const el of document.querySelectorAll('main button, main select, main input, #change, #change-output')) {
    if (running) el.dataset.wasDisabled = el.disabled;
    el.disabled = running || el.dataset.wasDisabled === 'true';
  }
}

async function convert() {
  showError('');
  $('result').hidden = true;
  const height = $('height').value === 'custom' ? Number($('custom-height').value) : Number($('height').value);
  const bySize = state.sizeMode === 'size';
  const opts = {
    input: state.input,
    output: state.output,
    format: state.format,
    compression: {
      mode: bySize ? 'size' : 'quality',
      quality: bySize ? 'balanced' : state.sizeMode,
      targetMB: Number($('target-mb').value),
    },
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
    const reveal = Object.assign(document.createElement('button'), {
      textContent: 'Show in folder',
      onclick: () => api.reveal(res.output),
    });
    $('result').replaceChildren(
      `✓ Saved ${baseName(res.output)} · ${formatBytes(res.size)}, ${changeText} · ${res.seconds.toFixed(1)}s`,
      reveal
    );
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

function acceptDrops(target) {
  target.addEventListener('dragover', (e) => {
    e.preventDefault();
    target.classList.add('over');
  });
  target.addEventListener('dragleave', (e) => {
    if (!target.contains(e.relatedTarget)) target.classList.remove('over');
  });
  target.addEventListener('drop', (e) => {
    e.preventDefault();
    target.classList.remove('over');
    const file = e.dataTransfer.files[0];
    if (file && !state.running) loadFile(api.pathForFile(file));
  });
}

async function init() {
  state.formats = await api.formats();
  for (const f of state.formats) {
    const b = Object.assign(document.createElement('button'), {
      className: 'pill',
      textContent: f.id.toUpperCase(),
      title: f.label,
    });
    b.dataset.value = f.id;
    b.onclick = () => {
      state.format = f.id;
      refreshOutput();
      refreshControls();
    };
    $(f.kind === 'audio' ? 'formats-audio' : 'formats-video').append(b);
  }

  for (const b of $('size-mode').children) {
    b.onclick = () => {
      state.sizeMode = b.dataset.value;
      refreshControls();
    };
  }

  const pick = async () => {
    const file = await api.pickFile();
    if (file) loadFile(file);
  };
  $('pick').onclick = pick;
  $('change').onclick = pick;

  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());
  acceptDrops($('drop'));
  acceptDrops($('editor'));

  $('height').onchange = refreshControls;
  $('target-mb').oninput = updateSizeHint;
  $('change-output').onclick = async () => {
    const chosen = await api.pickOutput(state.output, state.format);
    if (chosen) {
      state.output = chosen;
      state.outputChosen = true;
      showOutput();
    }
  };
  $('convert').onclick = convert;
  $('cancel').onclick = () => api.cancel();
  refreshControls();
}

init();
