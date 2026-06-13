/**
 * Generates the demo image set: a cohesive series of editorial art plates
 * used as the demo edition's photography. Deterministic (seeded per slug).
 * Run from apps/server so sharp resolves:
 *   cd apps/server && pnpm tsx ../../scripts/gen-demo-images.mts
 */

import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/demo/images');

/* ----------------------------- seeded prng ----------------------------- */

function makeRng(seedStr: string) {
  let h = 2166136261;
  for (const ch of seedStr) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  let s = h >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ------------------------------ palettes ------------------------------- */
// Each: [sky-light, sky-mid, band-mid, band-deep, deepest]

const PALETTES: Record<string, string[]> = {
  eat: ['#F4E7D3', '#E3BE9C', '#C97D54', '#8A4631', '#3D2A22'],
  drink: ['#F0E4CE', '#D3B488', '#96714B', '#4E3B2C', '#1F2C28'],
  cafe: ['#F5EAD8', '#E6C9A4', '#C99868', '#7E5638', '#33261C'],
  do: ['#EBE7D7', '#BCCDBD', '#7FA191', '#46695D', '#1F3D35'],
  shop: ['#F5EAD4', '#E5C896', '#C99F54', '#8A6B33', '#3A2F1C'],
  hotel: ['#EFE9D9', '#CFCBB0', '#8E9C88', '#476257', '#16352E'],
  hero: ['#F2E0C9', '#DFAE7E', '#B06A55', '#5C4456', '#252742'],
};

type Motif = 'horizon' | 'arch' | 'tide' | 'court';

interface Plate {
  slug: string;
  palette: string;
  motif: Motif;
  w: number;
  h: number;
}

const PLATES: Plate[] = [
  // hotel amenity blocks
  { slug: 'hotel-pool', palette: 'hotel', motif: 'court', w: 1800, h: 2400 },
  { slug: 'hotel-bistro', palette: 'drink', motif: 'arch', w: 1800, h: 2400 },
  { slug: 'hotel-rooms', palette: 'hotel', motif: 'horizon', w: 1800, h: 2400 },
  { slug: 'hotel-lobby', palette: 'hotel', motif: 'arch', w: 1800, h: 2400 },
  { slug: 'hotel-pier', palette: 'do', motif: 'tide', w: 1800, h: 2400 },
  { slug: 'hotel-hero', palette: 'hero', motif: 'horizon', w: 2400, h: 3200 },
  // eat & drink
  { slug: 'biz-luma', palette: 'eat', motif: 'arch', w: 1800, h: 2400 },
  { slug: 'biz-tidal', palette: 'eat', motif: 'horizon', w: 1800, h: 2400 },
  { slug: 'biz-curlew', palette: 'cafe', motif: 'court', w: 1800, h: 2400 },
  { slug: 'biz-saltbird', palette: 'drink', motif: 'tide', w: 1800, h: 2400 },
  { slug: 'biz-noon', palette: 'cafe', motif: 'horizon', w: 1800, h: 2400 },
  { slug: 'biz-hearth', palette: 'eat', motif: 'arch', w: 1800, h: 2400 },
  { slug: 'biz-jetty', palette: 'drink', motif: 'tide', w: 1800, h: 2400 },
  { slug: 'biz-corner', palette: 'cafe', motif: 'court', w: 1800, h: 2400 },
  // things to do
  { slug: 'biz-seabaths', palette: 'do', motif: 'tide', w: 1800, h: 2400 },
  { slug: 'biz-gallery', palette: 'hotel', motif: 'arch', w: 1800, h: 2400 },
  { slug: 'biz-reserve', palette: 'do', motif: 'horizon', w: 1800, h: 2400 },
  { slug: 'biz-sail', palette: 'do', motif: 'horizon', w: 1800, h: 2400 },
  { slug: 'biz-studio', palette: 'shop', motif: 'court', w: 1800, h: 2400 },
  { slug: 'biz-cinema', palette: 'hero', motif: 'arch', w: 1800, h: 2400 },
  // shops
  { slug: 'biz-mercer', palette: 'shop', motif: 'court', w: 1800, h: 2400 },
  { slug: 'biz-pages', palette: 'shop', motif: 'arch', w: 1800, h: 2400 },
  { slug: 'biz-grocer', palette: 'eat', motif: 'court', w: 1800, h: 2400 },
  { slug: 'biz-forage', palette: 'do', motif: 'tide', w: 1800, h: 2400 },
];

/* ----------------------------- svg helpers ----------------------------- */

const f = (v: number) => v.toFixed(1);

/** Organic band: a horizon stripe with a long, gentle bezier swell. */
function band(
  w: number,
  yBase: number,
  amp: number,
  phase: number,
  color: string,
  hBottom: number,
): string {
  const y1 = yBase + Math.sin(phase) * amp;
  const y2 = yBase + Math.sin(phase + 2.1) * amp;
  const y3 = yBase + Math.sin(phase + 4.4) * amp;
  return (
    `<path d="M0 ${f(y1)} C ${f(w * 0.25)} ${f(y1 - amp)}, ${f(w * 0.3)} ${f(y2 + amp)}, ${f(w * 0.55)} ${f(y2)} ` +
    `S ${f(w * 0.85)} ${f(y3 - amp * 0.8)}, ${f(w)} ${f(y3)} L ${f(w)} ${f(hBottom)} L 0 ${f(hBottom)} Z" fill="${color}"/>`
  );
}

function discWithReflection(
  cx: number,
  cy: number,
  r: number,
  color: string,
  waterY: number,
  h: number,
): string {
  let out = `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${color}"/>`;
  if (waterY > cy + r) {
    // broken-reflection bars below the waterline
    let y = waterY + r * 0.35;
    let bw = r * 1.5;
    let i = 0;
    while (y < h - r && i < 6) {
      out += `<rect x="${f(cx - bw / 2)}" y="${f(y)}" width="${f(bw)}" height="${f(r * 0.16)}" rx="${f(r * 0.08)}" fill="${color}" opacity="${(0.55 - i * 0.08).toFixed(2)}"/>`;
      y += r * 0.42;
      bw *= 0.82;
      i++;
    }
  }
  return out;
}

/* ------------------------------- motifs -------------------------------- */

function motifSvg(p: Plate, rng: () => number): string {
  const pal = PALETTES[p.palette]!;
  const { w, h } = p;
  const parts: string[] = [];
  const grad = (id: string, c1: string, c2: string, y2 = 1) =>
    `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="${y2}"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`;

  const defs: string[] = [grad('sky', pal[0]!, pal[1]!)];
  parts.push(`<rect width="${w}" height="${h}" fill="url(#sky)"/>`);

  if (p.motif === 'horizon') {
    const horizon = h * (0.42 + rng() * 0.16);
    const r = w * (0.1 + rng() * 0.07);
    const cx = w * (0.3 + rng() * 0.4);
    const cy = horizon - r * (1.1 + rng() * 1.6);
    parts.push(discWithReflection(cx, cy, r, pal[3]!, horizon, h));
    const bands = 3 + Math.floor(rng() * 2);
    for (let i = 0; i < bands; i++) {
      const yb = horizon + ((h - horizon) * i) / bands;
      const col = pal[Math.min(2 + i, 4)]!;
      parts.push(band(w, yb, h * 0.02 * (1 + i * 0.4), rng() * 6.28, col, h));
    }
  } else if (p.motif === 'arch') {
    // concentric arched doorways, off-center
    const baseY = h * (0.78 + rng() * 0.08);
    const cx = w * (0.38 + rng() * 0.24);
    const n = 4;
    for (let i = n; i >= 1; i--) {
      const aw = w * 0.17 * i * (0.92 + rng() * 0.1);
      const ah = h * 0.26 * i * 0.55;
      const col = pal[Math.min(1 + (n - i), 4)]!;
      parts.push(
        `<path d="M ${f(cx - aw / 2)} ${f(baseY)} L ${f(cx - aw / 2)} ${f(baseY - ah + aw / 2)} ` +
          `A ${f(aw / 2)} ${f(aw / 2)} 0 0 1 ${f(cx + aw / 2)} ${f(baseY - ah + aw / 2)} ` +
          `L ${f(cx + aw / 2)} ${f(baseY)} Z" fill="${col}"/>`,
      );
    }
    // floor
    parts.push(`<rect x="0" y="${f(baseY)}" width="${w}" height="${f(h - baseY)}" fill="${pal[4]}"/>`);
    const r = w * 0.055;
    parts.push(`<circle cx="${f(cx)}" cy="${f(baseY - h * 0.045)}" r="${f(r)}" fill="${pal[0]}"/>`);
  } else if (p.motif === 'tide') {
    // water bands with pier posts
    const horizon = h * (0.34 + rng() * 0.1);
    parts.push(`<rect x="0" y="0" width="${w}" height="${f(horizon)}" fill="url(#sky)"/>`);
    const bands = 4;
    for (let i = 0; i < bands; i++) {
      const yb = horizon + ((h - horizon) * i) / bands;
      parts.push(band(w, yb, h * 0.014 * (1 + i * 0.5), rng() * 6.28, pal[Math.min(1 + i, 4)]!, h));
    }
    const nPosts = 4 + Math.floor(rng() * 3);
    const px0 = w * (0.14 + rng() * 0.2);
    for (let i = 0; i < nPosts; i++) {
      const px = px0 + i * w * 0.13;
      const ph = h * (0.16 + 0.05 * Math.sin(i * 1.7 + rng() * 3));
      const pw = w * 0.018;
      parts.push(
        `<rect x="${f(px)}" y="${f(horizon - ph * 0.25)}" width="${f(pw)}" height="${f(ph)}" rx="${f(pw / 2)}" fill="${pal[4]}"/>`,
      );
      parts.push(
        `<rect x="${f(px)}" y="${f(horizon + ph * 0.78)}" width="${f(pw)}" height="${f(ph * 0.5)}" rx="${f(pw / 2)}" fill="${pal[4]}" opacity="0.35"/>`,
      );
    }
    const r = w * 0.09;
    parts.push(`<circle cx="${f(w * (0.62 + rng() * 0.2))}" cy="${f(horizon - r * 1.5)}" r="${f(r)}" fill="${pal[2]}"/>`);
  } else {
    // 'court' — tiled plane + ball/disc, abstract pool/courtyard
    const floorY = h * (0.4 + rng() * 0.12);
    defs.push(grad('floor', pal[2]!, pal[3]!));
    parts.push(`<rect x="0" y="${f(floorY)}" width="${w}" height="${f(h - floorY)}" fill="url(#floor)"/>`);
    // receding tile lines
    const n = 7;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const y = floorY + (h - floorY) * t * t;
      parts.push(`<rect x="0" y="${f(y)}" width="${w}" height="${f(2 + t * 4)}" fill="${pal[4]}" opacity="${(0.18 + t * 0.2).toFixed(2)}"/>`);
    }
    // pool shape
    const pw2 = w * (0.5 + rng() * 0.2);
    const px = (w - pw2) / 2 + (rng() - 0.5) * w * 0.15;
    const py = floorY + (h - floorY) * 0.22;
    const ph2 = (h - floorY) * 0.5;
    defs.push(grad('pool', pal[4]!, pal[2]!));
    parts.push(`<rect x="${f(px)}" y="${f(py)}" width="${f(pw2)}" height="${f(ph2)}" rx="${f(w * 0.04)}" fill="url(#pool)"/>`);
    // ladder / ripple marks
    for (let i = 0; i < 3; i++) {
      parts.push(
        `<rect x="${f(px + pw2 * 0.18)}" y="${f(py + ph2 * (0.3 + i * 0.18))}" width="${f(pw2 * 0.64)}" height="${f(h * 0.0035)}" rx="${f(h * 0.002)}" fill="${pal[0]}" opacity="0.3"/>`,
      );
    }
    const r = w * 0.06;
    parts.push(`<circle cx="${f(w * (0.2 + rng() * 0.6))}" cy="${f(floorY - r * 1.3)}" r="${f(r)}" fill="${pal[3]}"/>`);
  }

  // grain + vignette
  defs.push(
    `<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="${Math.floor(rng() * 99)}"/>` +
      `<feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.55 0.55 0.55 0 0"/></filter>`,
  );
  defs.push(
    `<radialGradient id="vig" cx="0.5" cy="0.46" r="0.75"><stop offset="0.62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#1a1208" stop-opacity="0.16"/></radialGradient>`,
  );
  parts.push(`<rect width="${w}" height="${h}" filter="url(#grain)" opacity="0.16"/>`);
  parts.push(`<rect width="${w}" height="${h}" fill="url(#vig)"/>`);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs>${defs.join('')}</defs>${parts.join('')}</svg>`
  );
}

/* --------------------------------- main --------------------------------- */

async function main() {
  await mkdir(OUT, { recursive: true });
  const manifest: Record<
    string,
    { width: number; height: number; focal: { x: number; y: number }; luma: { top: number; bottom: number; overall: number } }
  > = {};

  for (const plate of PLATES) {
    const rng = makeRng(plate.slug);
    const svg = motifSvg(plate, rng);
    const jpeg = await sharp(Buffer.from(svg), { density: 96 })
      .resize(plate.w, plate.h, { fit: 'fill' })
      .jpeg({ quality: 84, chromaSubsampling: '4:4:4' })
      .toBuffer();
    await writeFile(join(OUT, `${plate.slug}.jpg`), jpeg);

    // luma stats for scrim decisions (matches server upload pipeline)
    const { data, info } = await sharp(jpeg).resize(48).greyscale().raw().toBuffer({ resolveWithObject: true });
    const rows = info.height;
    const third = Math.floor(rows / 3);
    const mean = (from: number, to: number) => {
      let sum = 0;
      let n = 0;
      for (let y = from; y < to; y++)
        for (let x = 0; x < info.width; x++) {
          sum += data[y * info.width + x]!;
          n++;
        }
      return Math.round((sum / n / 255) * 1000) / 1000;
    };
    manifest[plate.slug] = {
      width: plate.w,
      height: plate.h,
      focal: { x: 0.5, y: plate.motif === 'horizon' ? 0.42 : 0.55 },
      luma: { top: mean(0, third), bottom: mean(rows - third, rows), overall: mean(0, rows) },
    };
    console.log('plate', plate.slug, `${(jpeg.length / 1024).toFixed(0)}KB`);
  }

  await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('done:', PLATES.length, 'plates →', OUT);
}

main();
