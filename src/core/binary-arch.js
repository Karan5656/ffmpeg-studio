const fs = require('fs');

// Read which CPU an executable was built for from its header, so a wrong download
// (e.g. an Intel ffprobe on an Apple Silicon Mac) is caught with a clear message
// instead of a cryptic "spawn Unknown system error -86".

const MACHO_CPU = { 0x01000007: 'x64', 0x0100000c: 'arm64', 7: 'ia32' };
const ELF_MACHINE = { 0x3e: 'x64', 0xb7: 'arm64', 0x03: 'ia32', 0x28: 'arm' };
const PE_MACHINE = { 0x8664: 'x64', 0xaa64: 'arm64', 0x14c: 'ia32' };

/** Architectures an executable header says it runs on, e.g. ['arm64'] (universal Mach-O lists several). */
function archesFromHeader(buf) {
  if (buf.length < 8) return [];
  const be = buf.readUInt32BE(0);
  const le = buf.readUInt32LE(0);
  if (le === 0xfeedfacf || le === 0xfeedface) return [MACHO_CPU[buf.readUInt32LE(4)] || 'unknown'];
  if (be === 0xcafebabe) {
    // Universal binary: big-endian list of 20-byte entries starting with the CPU type.
    const count = buf.readUInt32BE(4);
    const arches = [];
    for (let i = 0; i < count && 8 + i * 20 + 4 <= buf.length; i++) {
      arches.push(MACHO_CPU[buf.readUInt32BE(8 + i * 20)] || 'unknown');
    }
    return arches;
  }
  if (be === 0x7f454c46) return [ELF_MACHINE[buf.readUInt16LE(18)] || 'unknown'];
  if (buf[0] === 0x4d && buf[1] === 0x5a && buf.length >= 0x40) {
    const pe = buf.readUInt32LE(0x3c);
    if (pe + 6 <= buf.length && buf.readUInt32LE(pe) === 0x00004550) {
      return [PE_MACHINE[buf.readUInt16LE(pe + 4)] || 'unknown'];
    }
  }
  return [];
}

function readArches(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return archesFromHeader(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Throws a readable error if `file` is missing or built for a different CPU than
 * `arch` (defaults to this process's).
 */
function assertRunnable(name, file, arch = process.arch) {
  if (!file || !fs.existsSync(file)) {
    throw new Error(`The bundled ${name} is missing (${file}). Run "npm install" again.`);
  }
  const arches = readArches(file);
  if (arches.length && !arches.includes(arch)) {
    throw new Error(
      `The bundled ${name} is built for ${arches.join('/')}, but this computer needs ${arch}. ` +
        'Delete node_modules and run "npm install" again on this computer.'
    );
  }
}

module.exports = { archesFromHeader, readArches, assertRunnable };
