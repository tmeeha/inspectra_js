// WAV reading: mono (channel-averaged), DC-free, full-scale-normalised samples, plus the
// indices of clipped samples. Port of read_mono() in R/utils.R (which uses tuneR).
// Handles PCM 8/16/24/32-bit, IEEE float 32/64-bit, WAVE_FORMAT_EXTENSIBLE and any
// number of channels. Throws an Error with a readable message on failure.

export function isRiffWave(buf) {
  if (buf.byteLength < 12) return false;
  const b = new Uint8Array(buf, 0, 12);
  const s = (o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  return s(0) === "RIFF" && s(8) === "WAVE";
}

export function readWav(buf) {
  if (!isRiffWave(buf)) throw new Error("not a RIFF/WAVE file");
  const dv = new DataView(buf);
  const tag = (o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  let fmt = null, dataOff = -1, dataLen = 0;
  let o = 12;
  while (o + 8 <= buf.byteLength) {
    const id = tag(o); let size = dv.getUint32(o + 4, true);
    const body = o + 8;
    if (id === "fmt ") {
      let format = dv.getUint16(body, true);
      const channels = dv.getUint16(body + 2, true);
      const fs = dv.getUint32(body + 4, true);
      const blockAlign = dv.getUint16(body + 12, true);
      const bits = dv.getUint16(body + 14, true);
      if (format === 0xfffe && size >= 40) format = dv.getUint16(body + 24, true);  // sub-format GUID
      fmt = { format, channels, fs, blockAlign, bits };
    } else if (id === "data") {
      dataOff = body;
      // a streamed or truncated file may give a wrong length: use what is there
      dataLen = Math.min(size, buf.byteLength - body);
      if (fmt) break;
    }
    if (size > buf.byteLength) size = buf.byteLength;
    o = body + size + (size % 2);
  }
  if (!fmt) throw new Error("no format chunk");
  if (dataOff < 0) throw new Error("no audio data");
  const { format, channels, fs, bits } = fmt;
  const pcm = format === 1;
  if (!(pcm || format === 3)) throw new Error("unsupported WAV encoding (format " + format + ")");
  if (pcm && ![8, 16, 24, 32].includes(bits)) throw new Error("unsupported bit depth " + bits);
  if (!pcm && ![32, 64].includes(bits)) throw new Error("unsupported float bit depth " + bits);
  if (channels < 1 || fs < 1) throw new Error("invalid format chunk");
  const bps = bits / 8, frameBytes = bps * channels;
  const n = Math.floor(dataLen / frameBytes);
  if (n === 0) throw new Error("no audio samples");

  const get = pcm
    ? (bits === 8 ? (p) => dv.getUint8(p)
      : bits === 16 ? (p) => dv.getInt16(p, true)
      : bits === 24 ? (p) => { const v = dv.getUint8(p) | (dv.getUint8(p + 1) << 8) | (dv.getInt8(p + 2) << 16); return v; }
      : (p) => dv.getInt32(p, true))
    : (bits === 32 ? (p) => dv.getFloat32(p, true) : (p) => dv.getFloat64(p, true));
  // Clipped: within 0.1% of digital full scale in any channel
  const full = pcm ? Math.pow(2, bits - 1) : 1;
  const unit = pcm ? (bits === 8 ? (v) => (v - 128) / 128 : (v) => v / full) : (v) => v;

  const x = new Float64Array(n);
  const clip = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    let p = dataOff + i * frameBytes, acc = 0, cl = false;
    for (let c = 0; c < channels; c++, p += bps) {
      const v = get(p);
      acc += v;
      if (Math.abs(unit(v)) >= 0.999) cl = true;
    }
    if (cl) clip.push(i);
    const m = acc / channels;
    x[i] = m; sum += m;
  }
  const mean = sum / n;                       // DC removal (also fixes unsigned 8-bit)
  const scale = pcm ? 1 / full : 1;           // integer PCM -> +/-1 full scale
  for (let i = 0; i < n; i++) x[i] = (x[i] - mean) * scale;
  if (!x.every(Number.isFinite)) throw new Error("the file contains invalid samples");
  return { x, fs, clip: Int32Array.from(clip), channels, bits, float: !pcm };
}
