/**
 * Programmatic CMYK output profile — license-clean, generated entirely from
 * the shared device model (rgbToCmyk / cmykToRgb in @guide/shared) so the
 * profile a print bureau sees describes exactly the transform the studio
 * soft-proofs with.
 *
 * Format: ICC v2.4, class 'prtr', data space 'CMYK', PCS 'Lab ', D50.
 * Tags: desc, cprt, wtpt, A2B0 (lut16 CMYK→Lab, 9⁴ grid), B2A0 (lut16
 * Lab→CMYK, 17³ grid).
 *
 * Colour pipeline choice: the device model is CMYK↔sRGB (shared transforms);
 * sRGB linear RGB is converted to XYZ with the Bradford-adapted sRGB→XYZ(D50)
 * matrix (the same matrix the ICC sRGB profile uses), then to Lab against the
 * D50 white point encoded in the header. This keeps the PCS D50-native
 * without inventing new primaries.
 */

import { cmykToRgb, rgbToCmyk, type CMYK, type RGB } from '@guide/shared';

/* ------------------------------------------------------------------ */
/* Colour math                                                         */
/* ------------------------------------------------------------------ */

/** sRGB EOTF: encoded 0..1 -> linear 0..1. */
export function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** Inverse sRGB EOTF: linear 0..1 -> encoded 0..1. */
export function linearToSrgb(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return c < 0 ? 0 : c > 1 ? 1 : c;
}

/** Bradford-adapted sRGB(D65) -> XYZ(D50). */
const M_RGB_XYZ_D50 = [
  [0.4360747, 0.3850649, 0.1430804],
  [0.2225045, 0.7168786, 0.0606169],
  [0.0139322, 0.0971045, 0.7141733],
] as const;

/** Inverse of the above: XYZ(D50) -> linear sRGB. */
const M_XYZ_D50_RGB = [
  [3.1338561, -1.6168667, -0.4906146],
  [-0.9787684, 1.9161415, 0.033454],
  [0.0719453, -0.2289914, 1.4052427],
] as const;

/** D50 white point exactly as encoded in the profile header (s15Fixed16). */
export const D50 = {
  X: 0x0000f6d6 / 0x10000, // 0.96420288
  Y: 0x00010000 / 0x10000, // 1.0
  Z: 0x0000d32d / 0x10000, // 0.82490540
};

export function srgbToXyzD50([r, g, b]: RGB): [number, number, number] {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  return [
    M_RGB_XYZ_D50[0][0] * lr + M_RGB_XYZ_D50[0][1] * lg + M_RGB_XYZ_D50[0][2] * lb,
    M_RGB_XYZ_D50[1][0] * lr + M_RGB_XYZ_D50[1][1] * lg + M_RGB_XYZ_D50[1][2] * lb,
    M_RGB_XYZ_D50[2][0] * lr + M_RGB_XYZ_D50[2][1] * lg + M_RGB_XYZ_D50[2][2] * lb,
  ];
}

export function xyzD50ToSrgb([x, y, z]: [number, number, number]): RGB {
  const lr = M_XYZ_D50_RGB[0][0] * x + M_XYZ_D50_RGB[0][1] * y + M_XYZ_D50_RGB[0][2] * z;
  const lg = M_XYZ_D50_RGB[1][0] * x + M_XYZ_D50_RGB[1][1] * y + M_XYZ_D50_RGB[1][2] * z;
  const lb = M_XYZ_D50_RGB[2][0] * x + M_XYZ_D50_RGB[2][1] * y + M_XYZ_D50_RGB[2][2] * z;
  return [linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb)];
}

const LAB_EPS = 216 / 24389;
const LAB_KAPPA = 24389 / 27;

function fLab(t: number): number {
  return t > LAB_EPS ? Math.cbrt(t) : (LAB_KAPPA * t + 16) / 116;
}

function fLabInv(t: number): number {
  const t3 = t * t * t;
  return t3 > LAB_EPS ? t3 : (116 * t - 16) / LAB_KAPPA;
}

export function xyzToLab([x, y, z]: [number, number, number]): [number, number, number] {
  const fx = fLab(x / D50.X);
  const fy = fLab(y / D50.Y);
  const fz = fLab(z / D50.Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToXyz([L, a, b]: [number, number, number]): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  return [fLabInv(fx) * D50.X, fLabInv(fy) * D50.Y, fLabInv(fz) * D50.Z];
}

/* ------------------------------------------------------------------ */
/* ICC binary helpers                                                  */
/* ------------------------------------------------------------------ */

class ByteWriter {
  private chunks: number[] = [];

  get length(): number {
    return this.chunks.length;
  }

  u8(v: number): void {
    this.chunks.push(v & 0xff);
  }

  u16(v: number): void {
    this.u8(v >>> 8);
    this.u8(v);
  }

  u32(v: number): void {
    this.u8(v >>> 24);
    this.u8(v >>> 16);
    this.u8(v >>> 8);
    this.u8(v);
  }

  /** Signed 15.16 fixed point. */
  s15f16(v: number): void {
    this.u32(Math.round(v * 0x10000));
  }

  sig(s: string): void {
    if (s.length !== 4) throw new Error(`signature must be 4 chars: '${s}'`);
    for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i));
  }

  ascii(s: string): void {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i));
  }

  zeros(n: number): void {
    for (let i = 0; i < n; i++) this.u8(0);
  }

  padTo4(): void {
    while (this.chunks.length % 4 !== 0) this.u8(0);
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

/**
 * ICC v2 legacy 16-bit Lab encoding used inside lut16Type ('mft2'):
 * full scale is 0xFF00 — L 0..100 → 0..0xFF00, a/b −128..+127 → 0..0xFF00.
 */
export function encodeLabLegacy16(L: number, a: number, b: number): [number, number, number] {
  const enc = (v: number, lo: number, hi: number) => {
    const t = (v - lo) / (hi - lo);
    const n = Math.round(t * 0xff00);
    return n < 0 ? 0 : n > 0xffff ? 0xffff : n;
  };
  return [enc(L, 0, 100), enc(a, -128, 127), enc(b, -128, 127)];
}

export function decodeLabLegacy16(L: number, a: number, b: number): [number, number, number] {
  const dec = (v: number, lo: number, hi: number) => lo + (v / 0xff00) * (hi - lo);
  return [dec(L, 0, 100), dec(a, -128, 127), dec(b, -128, 127)];
}

/* ------------------------------------------------------------------ */
/* Tag builders                                                        */
/* ------------------------------------------------------------------ */

function descTag(text: string): Uint8Array {
  const w = new ByteWriter();
  w.sig('desc');
  w.u32(0);
  w.u32(text.length + 1); // ASCII count incl. terminator
  w.ascii(text);
  w.u8(0);
  w.u32(0); // unicode language code
  w.u32(0); // unicode count
  w.u16(0); // scriptcode code
  w.u8(0); // mac description length
  w.zeros(67); // mac description data
  w.padTo4();
  return w.bytes();
}

function textTag(text: string): Uint8Array {
  const w = new ByteWriter();
  w.sig('text');
  w.u32(0);
  w.ascii(text);
  w.u8(0);
  w.padTo4();
  return w.bytes();
}

function xyzTag(x: number, y: number, z: number): Uint8Array {
  const w = new ByteWriter();
  w.sig('XYZ ');
  w.u32(0);
  w.s15f16(x);
  w.s15f16(y);
  w.s15f16(z);
  return w.bytes();
}

interface Lut16Spec {
  inputChannels: number;
  outputChannels: number;
  gridPoints: number;
  /** Sample the CLUT at one grid coordinate (each component 0..1). Returns outputChannels values 0..0xFFFF. */
  sample: (coords: number[]) => number[];
}

function lut16Tag(spec: Lut16Spec): Uint8Array {
  const { inputChannels, outputChannels, gridPoints } = spec;
  const w = new ByteWriter();
  w.sig('mft2');
  w.u32(0);
  w.u8(inputChannels);
  w.u8(outputChannels);
  w.u8(gridPoints);
  w.u8(0); // padding
  // 3x3 identity matrix (only used when PCS is XYZ; required field regardless)
  w.s15f16(1);
  w.s15f16(0);
  w.s15f16(0);
  w.s15f16(0);
  w.s15f16(1);
  w.s15f16(0);
  w.s15f16(0);
  w.s15f16(0);
  w.s15f16(1);
  const tableEntries = 256;
  w.u16(tableEntries);
  w.u16(tableEntries);
  // Input tables: identity ramps, one per input channel.
  for (let ch = 0; ch < inputChannels; ch++) {
    for (let i = 0; i < tableEntries; i++) {
      w.u16(Math.round((i / (tableEntries - 1)) * 0xffff));
    }
  }
  // CLUT: gridPoints^inputChannels entries, last input channel varies fastest.
  const coords = new Array<number>(inputChannels).fill(0);
  const total = Math.pow(gridPoints, inputChannels);
  for (let idx = 0; idx < total; idx++) {
    let rem = idx;
    for (let ch = inputChannels - 1; ch >= 0; ch--) {
      coords[ch] = (rem % gridPoints) / (gridPoints - 1);
      rem = Math.floor(rem / gridPoints);
    }
    const out = spec.sample(coords);
    for (let ch = 0; ch < outputChannels; ch++) {
      const v = Math.round(out[ch] ?? 0);
      w.u16(v < 0 ? 0 : v > 0xffff ? 0xffff : v);
    }
  }
  // Output tables: identity ramps, one per output channel.
  for (let ch = 0; ch < outputChannels; ch++) {
    for (let i = 0; i < tableEntries; i++) {
      w.u16(Math.round((i / (tableEntries - 1)) * 0xffff));
    }
  }
  w.padTo4();
  return w.bytes();
}

/* ------------------------------------------------------------------ */
/* CLUT samplers                                                       */
/* ------------------------------------------------------------------ */

/** A2B0: device CMYK -> legacy-encoded Lab. */
function sampleA2B(coords: number[]): number[] {
  const cmyk: CMYK = [coords[0] ?? 0, coords[1] ?? 0, coords[2] ?? 0, coords[3] ?? 0];
  const rgb = cmykToRgb(cmyk);
  const xyz = srgbToXyzD50(rgb);
  const [L, a, b] = xyzToLab(xyz);
  return encodeLabLegacy16(L, a, b);
}

/** B2A0: legacy-encoded Lab -> device CMYK (each output 0..0xFFFF). */
function sampleB2A(coords: number[]): number[] {
  const [L, a, b] = decodeLabLegacy16(
    (coords[0] ?? 0) * 0xffff,
    (coords[1] ?? 0) * 0xffff,
    (coords[2] ?? 0) * 0xffff,
  );
  const xyz = labToXyz([Math.max(0, Math.min(100, L)), a, b]);
  const rgb = xyzD50ToSrgb(xyz);
  const cmyk = rgbToCmyk(rgb);
  return cmyk.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 0xffff));
}

/* ------------------------------------------------------------------ */
/* Profile assembly                                                    */
/* ------------------------------------------------------------------ */

export const PROFILE_DESCRIPTION = 'Guide Studio Coated CMYK';

const COPYRIGHT =
  'Copyright Guide Studio. Generated programmatically from the Guide Studio device model; no third-party profile data.';

/** Fixed creation timestamp for byte-determinism. */
const CREATED = { year: 2026, month: 1, day: 1, hours: 0, minutes: 0, seconds: 0 };

export function generateCmykProfile(): Uint8Array {
  // Tag data, in file order.
  const tags: { sig: string; data: Uint8Array }[] = [
    { sig: 'desc', data: descTag(PROFILE_DESCRIPTION) },
    { sig: 'cprt', data: textTag(COPYRIGHT) },
    { sig: 'wtpt', data: xyzTag(D50.X, D50.Y, D50.Z) },
    {
      sig: 'A2B0',
      data: lut16Tag({ inputChannels: 4, outputChannels: 3, gridPoints: 9, sample: sampleA2B }),
    },
    {
      sig: 'B2A0',
      data: lut16Tag({ inputChannels: 3, outputChannels: 4, gridPoints: 17, sample: sampleB2A }),
    },
  ];

  const headerSize = 128;
  const tagTableSize = 4 + tags.length * 12;
  let offset = headerSize + tagTableSize;
  // 4-byte alignment for the first tag (tag table size is already a multiple of 4).
  const placed = tags.map((t) => {
    const at = offset;
    offset += t.data.length;
    while (offset % 4 !== 0) offset += 1;
    return { ...t, offset: at };
  });
  const totalSize = offset;

  const w = new ByteWriter();
  // --- 128-byte header ---
  w.u32(totalSize); // 0: profile size
  w.sig('GStu'); // 4: preferred CMM type (free field)
  w.u32(0x02400000); // 8: version 2.4.0
  w.sig('prtr'); // 12: device class
  w.sig('CMYK'); // 16: data colour space
  w.sig('Lab '); // 20: PCS
  w.u16(CREATED.year); // 24: dateTimeNumber
  w.u16(CREATED.month);
  w.u16(CREATED.day);
  w.u16(CREATED.hours);
  w.u16(CREATED.minutes);
  w.u16(CREATED.seconds);
  w.sig('acsp'); // 36: profile file signature
  w.u32(0); // 40: primary platform (none)
  w.u32(0); // 44: flags
  w.sig('GStu'); // 48: device manufacturer (free field)
  w.u32(0); // 52: device model
  w.u32(0); // 56: device attributes (8 bytes)
  w.u32(0);
  w.u32(0); // 64: rendering intent: perceptual
  w.u32(0x0000f6d6); // 68: PCS illuminant X (D50)
  w.u32(0x00010000); //     Y
  w.u32(0x0000d32d); //     Z
  w.sig('GStu'); // 80: profile creator
  w.zeros(44); // 84..127: reserved (profile ID zero for v2)

  // --- tag table ---
  w.u32(tags.length);
  for (const t of placed) {
    w.sig(t.sig);
    w.u32(t.offset);
    w.u32(t.data.length);
  }

  // --- tag data ---
  for (const t of placed) {
    while (w.length < t.offset) w.u8(0);
    for (const b of t.data) w.u8(b);
  }
  while (w.length < totalSize) w.u8(0);

  const bytes = w.bytes();
  if (bytes.length !== totalSize) {
    throw new Error(`ICC assembly size mismatch: ${bytes.length} != ${totalSize}`);
  }
  return bytes;
}
