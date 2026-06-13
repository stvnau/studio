/**
 * Geometry primitives. The entire system works in PDF points (1pt = 1/72in)
 * with a top-left origin and y increasing downward. The press writer is the
 * single place where the y-axis is flipped into PDF's bottom-left space.
 */

export const PT_PER_MM = 72 / 25.4;

export const mm = (v: number): number => v * PT_PER_MM;
export const ptToMm = (v: number): number => v / PT_PER_MM;

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Affine transform [a b c d e f] mapping (x,y) -> (ax+cy+e, bx+dy+f). */
export type Mat2D = [number, number, number, number, number, number];

export const IDENTITY: Mat2D = [1, 0, 0, 1, 0, 0];

export function matMul(m1: Mat2D, m2: Mat2D): Mat2D {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export function matApply(m: Mat2D, p: Vec2): Vec2 {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function translate(tx: number, ty: number): Mat2D {
  return [1, 0, 0, 1, tx, ty];
}

export function scale(sx: number, sy = sx): Mat2D {
  return [sx, 0, 0, sy, 0, 0];
}

export function rotate(rad: number): Mat2D {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, s, -s, c, 0, 0];
}

export function rectContains(r: Rect, p: Vec2): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function rectInset(r: Rect, d: number): Rect {
  return { x: r.x + d, y: r.y + d, w: r.w - 2 * d, h: r.h - 2 * d };
}

export function rectUnion(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/**
 * Path segments — the only path representation in the system.
 * Mirrors PDF/SVG verbs exactly so both painters consume it losslessly.
 */
export type Seg =
  | ['M', number, number]
  | ['L', number, number]
  | ['C', number, number, number, number, number, number]
  | ['Q', number, number, number, number]
  | ['Z'];

export type PathSpec = Seg[];

export function rectPath(r: Rect): PathSpec {
  return [
    ['M', r.x, r.y],
    ['L', r.x + r.w, r.y],
    ['L', r.x + r.w, r.y + r.h],
    ['L', r.x, r.y + r.h],
    ['Z'],
  ];
}

/** Rounded-rect path using cubic approximation (k = 4/3·(√2−1)). */
export function roundedRectPath(r: Rect, radius: number): PathSpec {
  const rad = Math.min(radius, r.w / 2, r.h / 2);
  if (rad <= 0) return rectPath(r);
  const k = 0.5522847498307936 * rad;
  const { x, y, w, h } = r;
  return [
    ['M', x + rad, y],
    ['L', x + w - rad, y],
    ['C', x + w - rad + k, y, x + w, y + rad - k, x + w, y + rad],
    ['L', x + w, y + h - rad],
    ['C', x + w, y + h - rad + k, x + w - rad + k, y + h, x + w - rad, y + h],
    ['L', x + rad, y + h],
    ['C', x + rad - k, y + h, x, y + h - rad + k, x, y + h - rad],
    ['L', x, y + rad],
    ['C', x, y + rad - k, x + rad - k, y, x + rad, y],
    ['Z'],
  ];
}

export function circlePath(cx: number, cy: number, r: number): PathSpec {
  const k = 0.5522847498307936 * r;
  return [
    ['M', cx + r, cy],
    ['C', cx + r, cy + k, cx + k, cy + r, cx, cy + r],
    ['C', cx - k, cy + r, cx - r, cy + k, cx - r, cy],
    ['C', cx - r, cy - k, cx - k, cy - r, cx, cy - r],
    ['C', cx + k, cy - r, cx + r, cy - k, cx + r, cy],
    ['Z'],
  ];
}

export function pathBounds(path: PathSpec): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const consider = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const seg of path) {
    switch (seg[0]) {
      case 'M':
      case 'L':
        consider(seg[1], seg[2]);
        break;
      case 'Q':
        consider(seg[1], seg[2]);
        consider(seg[3], seg[4]);
        break;
      case 'C':
        consider(seg[1], seg[2]);
        consider(seg[3], seg[4]);
        consider(seg[5], seg[6]);
        break;
      case 'Z':
        break;
    }
  }
  if (minX === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function transformPath(path: PathSpec, m: Mat2D): PathSpec {
  const tx = (x: number, y: number): [number, number] => [
    m[0] * x + m[2] * y + m[4],
    m[1] * x + m[3] * y + m[5],
  ];
  return path.map((seg): Seg => {
    switch (seg[0]) {
      case 'M':
      case 'L': {
        const [x, y] = tx(seg[1], seg[2]);
        return [seg[0], x, y];
      }
      case 'Q': {
        const [x1, y1] = tx(seg[1], seg[2]);
        const [x2, y2] = tx(seg[3], seg[4]);
        return ['Q', x1, y1, x2, y2];
      }
      case 'C': {
        const [x1, y1] = tx(seg[1], seg[2]);
        const [x2, y2] = tx(seg[3], seg[4]);
        const [x3, y3] = tx(seg[5], seg[6]);
        return ['C', x1, y1, x2, y2, x3, y3];
      }
      case 'Z':
        return ['Z'];
    }
  });
}

/** Serialize a PathSpec to an SVG `d` attribute string. */
export function pathToSvg(path: PathSpec, precision = 3): string {
  const n = (v: number) => {
    const r = v.toFixed(precision);
    return r.replace(/\.?0+$/, '') || '0';
  };
  return path
    .map((seg) =>
      seg[0] === 'Z' ? 'Z' : `${seg[0]}${(seg.slice(1) as number[]).map(n).join(' ')}`,
    )
    .join('');
}
