const test = require('node:test');
const assert = require('node:assert');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const { archesFromHeader, readArches, assertRunnable } = require('../src/core/binary-arch');

test('bundled ffmpeg and ffprobe match this machine', () => {
  assert.deepStrictEqual(readArches(ffmpegPath), [process.arch]);
  assert.deepStrictEqual(readArches(ffprobePath), [process.arch]);
  assertRunnable('ffmpeg', ffmpegPath);
  assertRunnable('ffprobe', ffprobePath);
});

function machO(cpu) {
  const b = Buffer.alloc(16);
  b.writeUInt32LE(0xfeedfacf, 0);
  b.writeUInt32LE(cpu, 4);
  return b;
}

test('reads Mach-O, universal, ELF and PE headers', () => {
  assert.deepStrictEqual(archesFromHeader(machO(0x0100000c)), ['arm64']);
  assert.deepStrictEqual(archesFromHeader(machO(0x01000007)), ['x64']);

  const fat = Buffer.alloc(48);
  fat.writeUInt32BE(0xcafebabe, 0);
  fat.writeUInt32BE(2, 4);
  fat.writeUInt32BE(0x01000007, 8);
  fat.writeUInt32BE(0x0100000c, 28);
  assert.deepStrictEqual(archesFromHeader(fat), ['x64', 'arm64']);

  const elf = Buffer.alloc(64);
  elf.writeUInt32BE(0x7f454c46, 0);
  elf.writeUInt16LE(0xb7, 18);
  assert.deepStrictEqual(archesFromHeader(elf), ['arm64']);

  const pe = Buffer.alloc(0x100);
  pe.write('MZ', 0);
  pe.writeUInt32LE(0x80, 0x3c);
  pe.writeUInt32LE(0x00004550, 0x80);
  pe.writeUInt16LE(0x8664, 0x84);
  assert.deepStrictEqual(archesFromHeader(pe), ['x64']);
});

test('an Intel binary on Apple Silicon gives a readable error', () => {
  // ffprobe-static's darwin/arm64 file is really x86_64; this is the check that catches it.
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'arch-')), 'ffprobe');
  fs.writeFileSync(file, machO(0x01000007));
  assert.throws(() => assertRunnable('ffprobe', file, 'arm64'), /built for x64, but this computer needs arm64/);
  assert.doesNotThrow(() => assertRunnable('ffprobe', file, 'x64'));
  fs.rmSync(path.dirname(file), { recursive: true });
});
