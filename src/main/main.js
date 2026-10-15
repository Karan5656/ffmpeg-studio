const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ffmpegPath, ffprobePath, checkBinaries } = require('./binaries');
const { probe, runPasses } = require('../core/ffmpeg');
const { buildJobs, parseTime, defaultOutputPath } = require('../core/build-jobs');
const { encodeImageToSize } = require('../core/image-size');
const { FORMATS } = require('../core/formats');

let win;
let current = null; // the running job, if any

function createWindow() {
  win = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 760,
    minHeight: 600,
    title: 'FFmpeg Studio',
    backgroundColor: '#14161a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

ipcMain.handle('formats', () =>
  Object.entries(FORMATS).map(([id, f]) => ({ id, label: f.label, kind: f.kind }))
);

ipcMain.handle('pick-file', async () => {
  const res = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      { name: 'Media', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'flv', 'wmv', 'gif', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus', 'jpg', 'jpeg', 'png', 'webp', 'bmp', 'tif', 'tiff'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('probe', (_e, file) => probe(ffprobePath, file));

ipcMain.handle('default-output', (_e, input, format) => defaultOutputPath(input, format, fs.existsSync));

ipcMain.handle('pick-output', async (_e, suggested, format) => {
  const res = await dialog.showSaveDialog(win, {
    defaultPath: suggested,
    filters: [{ name: FORMATS[format]?.label || format, extensions: [format] }],
  });
  return res.canceled ? null : res.filePath;
});

ipcMain.handle('convert', async (_e, opts) => {
  if (current) throw new Error('A conversion is already running.');
  if (path.resolve(opts.input) === path.resolve(opts.output)) {
    throw new Error('The output file must be different from the input file.');
  }
  const info = await probe(ffprobePath, opts.input);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-studio-'));
  const { passes, duration } = buildJobs(
    {
      ...opts,
      trim: { start: parseTime(opts.trim?.start), end: parseTime(opts.trim?.end) },
      passLogPrefix: path.join(tmp, 'pass'),
    },
    info
  );

  const started = Date.now();
  const onProgress = (p) => win?.webContents.send('progress', p);
  const fmt = FORMATS[opts.format];
  current =
    fmt.kind === 'image' && opts.compression?.mode === 'size' && !fmt.lossless
      ? encodeImageToSize(ffmpegPath, opts, onProgress)
      : runPasses(ffmpegPath, passes, duration, onProgress);
  try {
    await current.promise;
    const size = fs.statSync(opts.output).size;
    return { output: opts.output, size, seconds: (Date.now() - started) / 1000 };
  } catch (err) {
    // Don't leave a half-written file behind.
    fs.rmSync(opts.output, { force: true });
    throw err;
  } finally {
    current = null;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

ipcMain.handle('cancel', () => current?.cancel());

ipcMain.handle('reveal', (_e, file) => shell.showItemInFolder(file));

app.whenReady().then(() => {
  try {
    checkBinaries();
  } catch (err) {
    dialog.showErrorBox('FFmpeg Studio can’t start', err.message);
    app.quit();
    return;
  }
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => {
  current?.cancel();
  if (process.platform !== 'darwin') app.quit();
});
