import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Linking, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { FORMATS, FORMAT_IDS, type Quality } from './src/core/formats.ts';
import { parseTime, type ProbeInfo } from './src/core/build-jobs.ts';
import {
  canMake, formatBytes, formatDuration, outputName, resizeFromChoice, sameFormat, sizeChoices, toMB,
} from './src/core/media.ts';
import { convert, fileSize, probe, uriToPath, type Job } from './src/ffmpeg.ts';
import { cleanWorkDir, pickFromFiles, pickFromGallery, saveFile, shareFile, workDir, type Picked } from './src/files.ts';
import { runSelfTest, selfTestRequested } from './src/selftest.ts';
import { Button, Card, Pill, ProgressBar, Row, Section, useTheme, type Theme } from './src/ui/parts.tsx';

type SizeMode = Quality | 'size';

interface Result {
  path: string;
  size: number;
  seconds: number;
}

const GROUPS: [string, string[]][] = [['Video', ['video', 'gif']], ['Audio', ['audio']], ['Image', ['image']]];
const GIF_FPS = [8, 12, 15, 24];

export default function App() {
  return (
    <SafeAreaProvider>
      <Studio />
    </SafeAreaProvider>
  );
}

function Studio() {
  const t = useTheme();
  const [file, setFile] = useState<Picked | null>(null);
  const [info, setInfo] = useState<ProbeInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [format, setFormat] = useState('mp4');
  const [sizeMode, setSizeMode] = useState<SizeMode>('balanced');
  const [targetMB, setTargetMB] = useState('');
  const [resolution, setResolution] = useState('0');
  const [trimStart, setTrimStart] = useState('');
  const [trimEnd, setTrimEnd] = useState('');
  const [removeAudio, setRemoveAudio] = useState(false);
  const [gifFps, setGifFps] = useState(12);
  const [progress, setProgress] = useState<{ label: string; fraction: number } | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [selfTest, setSelfTest] = useState<string[] | null>(null);
  const job = useRef<Job | null>(null);

  // ffmpegstudio://selftest (or a Documents/selftest-request file, which the iOS simulator
  // can be given without a link prompt) runs every format on a generated clip. Used by CI.
  useEffect(() => {
    let started = false;
    const run = () => {
      if (started) return;
      started = true;
      setSelfTest([]);
      runSelfTest((line) => setSelfTest((lines) => [...(lines || []), line]));
    };
    if (selfTestRequested()) run();
    Linking.getInitialURL().then((url) => url?.includes('selftest') && run());
    const sub = Linking.addEventListener('url', (e) => e.url.includes('selftest') && run());
    return () => sub.remove();
  }, []);

  const fmt = FORMATS[format];
  const running = progress !== null;
  const lossless = Boolean(fmt?.lossless);
  const isGif = fmt?.kind === 'gif';
  const isAudio = fmt?.kind === 'audio';
  const isImage = fmt?.kind === 'image';
  const sizes = useMemo(() => (info ? sizeChoices(info) : []), [info]);

  async function pick(from: 'gallery' | 'files') {
    setError('');
    try {
      const picked = from === 'gallery' ? await pickFromGallery() : await pickFromFiles();
      if (!picked) return;
      setLoading(true);
      const probed = await probe(picked.path);
      // Drop copies of earlier picks and old results; keep only this file.
      cleanWorkDir([picked.path]);
      setFile(picked);
      setInfo(probed);
      setResult(null);
      // Start from the file as it is: same format, same size, original resolution.
      setFormat(sameFormat(picked.name, probed));
      setSizeMode(probed.size ? 'size' : 'balanced');
      setTargetMB(probed.size ? String(toMB(probed.size)) : '');
      setResolution('0');
      setTrimStart('');
      setTrimEnd('');
      setRemoveAudio(false);
    } catch (err) {
      setError(`Couldn't read that file: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  async function start() {
    if (!file || !info) return;
    setError('');
    setResult(null);
    const began = Date.now();
    try {
      const output = `${uriToPath(workDir().uri).replace(/\/$/, '')}/${outputName(file.name, format)}`;
      const bySize = sizeMode === 'size' && !lossless && !isGif;
      const opts = {
        input: file.path,
        output,
        format,
        compression: {
          mode: bySize ? ('size' as const) : ('quality' as const),
          quality: sizeMode === 'size' ? ('balanced' as const) : sizeMode,
          targetMB: Number(targetMB),
        },
        resize: isAudio ? {} : resizeFromChoice(resolution),
        trim: isImage ? {} : { start: parseTime(trimStart), end: parseTime(trimEnd) },
        removeAudio,
        gifFps,
        passLogPrefix: `${uriToPath(workDir().uri).replace(/\/$/, '')}/ffmpeg2pass`,
      };
      setProgress({ label: 'Starting…', fraction: 0 });
      activateKeepAwakeAsync('convert').catch(() => {});
      job.current = convert(opts, info, setProgress);
      await job.current.promise;
      setResult({ path: output, size: fileSize(output), seconds: (Date.now() - began) / 1000 });
    } catch (err) {
      if ((err as Error).message !== 'Cancelled') setError((err as Error).message);
    } finally {
      job.current = null;
      setProgress(null);
      deactivateKeepAwake('convert');
    }
  }

  async function save() {
    if (!result) return;
    try {
      const where = await saveFile(result.path);
      if (where) Alert.alert('Saved', `${result.path.split('/').pop()} was saved to ${where}.`);
    } catch (err) {
      setError(`Couldn't save: ${(err as Error).message}`);
    }
  }

  async function share() {
    if (!result) return;
    try {
      await shareFile(result.path);
    } catch (err) {
      setError(`Couldn't share: ${(err as Error).message}`);
    }
  }

  if (selfTest) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: t.bg }]}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.title, { color: t.text }]}>Self-test</Text>
          {selfTest.map((line, i) => (
            <Text key={i} style={[styles.mono, { color: t.text }]}>{line}</Text>
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: t.bg }]}>
      <StatusBar style="auto" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: t.text }]}>FFmpeg Studio</Text>
        <Text style={[styles.subtitle, { color: t.muted }]}>
          Convert, compress, resize and trim video, audio and images.
        </Text>

        {!file || !info ? (
          <Card t={t} style={styles.empty}>
            <Text style={[styles.emptyText, { color: t.text }]}>
              {loading ? 'Reading the file…' : 'Pick a video, audio file or image to start.'}
            </Text>
            <View style={styles.buttons}>
              <Button t={t} label="Photos & videos" onPress={() => pick('gallery')} disabled={loading} />
              <Button t={t} label="Files" kind="secondary" onPress={() => pick('files')} disabled={loading} />
            </View>
            {error ? <Text style={[styles.error, { color: t.danger }]}>{error}</Text> : null}
          </Card>
        ) : (
          <>
            <FileCard t={t} file={file} info={info} />
            <View style={styles.buttons}>
              <Button t={t} label="Photos & videos" kind="secondary" onPress={() => pick('gallery')} disabled={running || loading} />
              <Button t={t} label="Files" kind="secondary" onPress={() => pick('files')} disabled={running || loading} />
            </View>

            <Card t={t} style={styles.settings}>
              <Section t={t} title="Format">
                {GROUPS.map(([group, kinds]) => {
                  const ids = FORMAT_IDS.filter((id) => kinds.includes(FORMATS[id].kind) && canMake(FORMATS[id], info));
                  if (!ids.length) return null;
                  return (
                    <View key={group} style={styles.group}>
                      <Row>
                        {ids.map((id) => (
                          <Pill key={id} t={t} label={FORMATS[id].label} on={id === format}
                            onPress={() => setFormat(id)} disabled={running} />
                        ))}
                      </Row>
                    </View>
                  );
                })}
              </Section>

              <Section
                t={t}
                title="File size"
                note={lossless
                  ? isImage ? 'PNG is lossless, so only Resolution changes its size.' : "WAV is uncompressed, so its size can't be changed."
                  : isGif ? 'GIF size depends on resolution and frame rate.' : undefined}
              >
                {!lossless && !isGif ? (
                  <>
                    <Row>
                      {(['high', 'balanced', 'small'] as const).map((q) => (
                        <Pill key={q} t={t} on={sizeMode === q} disabled={running} onPress={() => setSizeMode(q)}
                          label={q === 'high' ? 'High quality' : q === 'balanced' ? 'Balanced' : 'Smallest'} />
                      ))}
                      <Pill t={t} label="Target size" on={sizeMode === 'size'} disabled={running} onPress={() => setSizeMode('size')} />
                    </Row>
                    {sizeMode === 'size' ? (
                      <View style={styles.inline}>
                        <TextInput
                          value={targetMB}
                          onChangeText={setTargetMB}
                          keyboardType="decimal-pad"
                          editable={!running}
                          style={[styles.input, styles.mbInput, { color: t.text, borderColor: t.border, backgroundColor: t.bg }]}
                        />
                        <Text style={[styles.hint, { color: t.muted }]}>{sizeHint(targetMB, info.size)}</Text>
                      </View>
                    ) : null}
                  </>
                ) : null}
              </Section>

              {!isAudio ? (
                <Section t={t} title="Resolution">
                  <Row>
                    {sizes.map((s) => (
                      <Pill key={s.id} t={t} label={s.label} on={resolution === s.id} disabled={running}
                        onPress={() => setResolution(s.id)} />
                    ))}
                  </Row>
                </Section>
              ) : null}

              {!isImage ? (
                <Section t={t} title="Trim" note="Seconds, or m:ss. Leave empty to keep the whole file.">
                  <View style={styles.inline}>
                    <TextInput placeholder="Start 0:00" placeholderTextColor={t.muted} value={trimStart}
                      onChangeText={setTrimStart} editable={!running} keyboardType="numbers-and-punctuation"
                      style={[styles.input, styles.flex, { color: t.text, borderColor: t.border, backgroundColor: t.bg }]} />
                    <TextInput placeholder={`End ${formatDuration(info.duration)}`} placeholderTextColor={t.muted}
                      value={trimEnd} onChangeText={setTrimEnd} editable={!running} keyboardType="numbers-and-punctuation"
                      style={[styles.input, styles.flex, { color: t.text, borderColor: t.border, backgroundColor: t.bg }]} />
                  </View>
                </Section>
              ) : null}

              {fmt?.kind === 'video' && info.hasAudio ? (
                <View style={[styles.switchRow, { borderColor: t.border }]}>
                  <Text style={[styles.switchLabel, { color: t.text }]}>Remove audio</Text>
                  <Switch value={removeAudio} onValueChange={setRemoveAudio} disabled={running} />
                </View>
              ) : null}

              {isGif ? (
                <Section t={t} title="GIF frame rate">
                  <Row>
                    {GIF_FPS.map((fps) => (
                      <Pill key={fps} t={t} label={`${fps} fps`} on={gifFps === fps} disabled={running}
                        onPress={() => setGifFps(fps)} />
                    ))}
                  </Row>
                </Section>
              ) : null}
            </Card>

            {error ? <Text style={[styles.error, { color: t.danger }]}>{error}</Text> : null}

            {running ? (
              <Card t={t}>
                <Text style={[styles.progressLabel, { color: t.text }]}>
                  {progress.label} · {Math.round(progress.fraction * 100)}%
                </Text>
                <ProgressBar t={t} fraction={progress.fraction} />
                <View style={[styles.buttons, styles.topGap]}>
                  <Button t={t} label="Cancel" kind="danger" onPress={() => job.current?.cancel()} />
                </View>
              </Card>
            ) : (
              <View style={styles.buttons}>
                <Button t={t} label="Convert" onPress={start} />
              </View>
            )}

            {result ? <ResultCard t={t} result={result} before={info.size} onSave={save} onShare={share} /> : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function FileCard({ t, file, info }: { t: Theme; file: Picked; info: ProbeInfo }) {
  const chips = info.isImage
    ? [formatBytes(info.size), `${info.width}×${info.height}`, info.videoCodec.replace('mjpeg', 'jpeg').toUpperCase()]
    : [formatBytes(info.size), formatDuration(info.duration)];
  if (info.hasVideo && !info.isImage) {
    chips.push(`${info.width}×${info.height}`, info.videoCodec, info.fps ? `${info.fps} fps` : '');
  }
  if (info.hasAudio) chips.push(`${info.audioCodec} audio`);
  return (
    <Card t={t}>
      <Text style={[styles.fileName, { color: t.text }]} numberOfLines={2}>{file.name}</Text>
      <View style={[styles.row, styles.topGap]}>
        {chips.filter(Boolean).map((c, i) => (
          <Text key={i} style={[styles.chip, { color: t.muted, backgroundColor: t.chip }]}>{c}</Text>
        ))}
      </View>
    </Card>
  );
}

function ResultCard({ t, result, before, onSave, onShare }: {
  t: Theme; result: Result; before: number; onSave: () => void; onShare: () => void;
}) {
  const change = before ? Math.round((1 - result.size / before) * 100) : 0;
  const changeText = change >= 0 ? `${change}% smaller` : `${-change}% larger`;
  return (
    <Card t={t} style={styles.topGap}>
      <Text style={[styles.resultTitle, { color: t.success }]}>✓ Done</Text>
      <Text style={[styles.fileName, { color: t.text }]} numberOfLines={2}>{result.path.split('/').pop()}</Text>
      <Text style={[styles.hint, { color: t.muted }]}>
        {formatBytes(result.size)}, {changeText} · took {result.seconds.toFixed(1)}s
      </Text>
      <View style={[styles.buttons, styles.topGap]}>
        <Button t={t} label="Save" onPress={onSave} />
        <Button t={t} label="Share" kind="secondary" onPress={onShare} />
      </View>
    </Card>
  );
}

function sizeHint(text: string, bytes: number): string {
  const mb = Number(text);
  if (!bytes || !(mb > 0)) return 'MB';
  const original = toMB(bytes);
  return mb === original ? 'MB · same as the original' : `MB · ${Math.round((mb / original) * 100)}% of ${original} MB`;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: '700' },
  subtitle: { fontSize: 15, marginTop: 4, marginBottom: 16 },
  empty: { paddingVertical: 28 },
  emptyText: { fontSize: 17, textAlign: 'center', marginBottom: 16 },
  buttons: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  settings: { paddingTop: 2 },
  group: { marginBottom: 8 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  mbInput: { width: 110 },
  flex: { flex: 1 },
  hint: { fontSize: 14 },
  switchRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 14, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth,
  },
  switchLabel: { fontSize: 16 },
  error: { fontSize: 15, marginBottom: 12, marginTop: 4 },
  progressLabel: { fontSize: 15, marginBottom: 10 },
  topGap: { marginTop: 10 },
  fileName: { fontSize: 17, fontWeight: '600' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { fontSize: 13, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' },
  resultTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  mono: { fontFamily: 'Courier', fontSize: 13, marginTop: 4 },
});
