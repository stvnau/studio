/**
 * Linear gradients as PDF Type 2 (axial) shadings.
 *
 * Colour: a Type 2 (exponential, N=1) function per pair of adjacent stops,
 * chained with a Type 3 stitching function for multi-stop gradients.
 * DeviceCMYK in press mode, DeviceRGB (soft-proofed) in proof mode.
 *
 * Alpha gradients (photo scrims): the colour shading is painted under an
 * ExtGState whose /SMask is a luminosity transparency group — a Form XObject
 * containing a parallel DeviceGray axial shading whose stops are the alpha
 * values. Luminance 1 = opaque, 0 = transparent, so the gradient's alpha ramp
 * becomes the gray ramp of the mask.
 */

import { PDFDict, PDFDocument, PDFName, PDFRef } from 'pdf-lib';
import { colorToScreenRgb, effectiveCmyk, type LinearGradient, type Rect } from '@guide/shared';

interface NormStop {
  at: number;
  values: number[]; // colour components in the target space
}

function normalizeStops(grad: LinearGradient, toValues: (i: number) => number[]): NormStop[] {
  const stops = grad.stops.map((s, i) => ({ at: s.at, values: toValues(i) }));
  stops.sort((a, b) => a.at - b.at);
  if (stops.length === 0) return [{ at: 0, values: [0] }, { at: 1, values: [0] }];
  if (stops.length === 1) return [{ at: 0, values: stops[0]!.values }, { at: 1, values: stops[0]!.values }];
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (first.at > 0) stops.unshift({ at: 0, values: first.values });
  if (last.at < 1) stops.push({ at: 1, values: last.values });
  first.at < 0 && (first.at = 0);
  last.at > 1 && (last.at = 1);
  return stops;
}

/** Type 2 exponential function between two colour vectors. */
function expFunction(doc: PDFDocument, c0: number[], c1: number[]): PDFRef {
  return doc.context.register(
    doc.context.obj({ FunctionType: 2, Domain: [0, 1], C0: c0, C1: c1, N: 1 }),
  );
}

/** Stitch normalized stops into one function over [0,1]. */
function stopsFunction(doc: PDFDocument, stops: NormStop[]): PDFRef {
  if (stops.length === 2) return expFunction(doc, stops[0]!.values, stops[1]!.values);
  const fns: PDFRef[] = [];
  const bounds: number[] = [];
  const encode: number[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    fns.push(expFunction(doc, stops[i]!.values, stops[i + 1]!.values));
    if (i > 0) bounds.push(stops[i]!.at);
    encode.push(0, 1);
  }
  return doc.context.register(
    doc.context.obj({
      FunctionType: 3,
      Domain: [0, 1],
      Functions: fns,
      Bounds: bounds,
      Encode: encode,
    }),
  );
}

/** Axial (Type 2) shading dict for the gradient's colours. */
export function buildAxialShading(
  doc: PDFDocument,
  grad: LinearGradient,
  mode: 'press' | 'proof',
): PDFRef {
  const stops = normalizeStops(grad, (i) => {
    const c = grad.stops[i]!.color;
    return mode === 'press' ? [...effectiveCmyk(c)] : [...colorToScreenRgb(c)];
  });
  return doc.context.register(
    doc.context.obj({
      ShadingType: 2,
      ColorSpace: mode === 'press' ? 'DeviceCMYK' : 'DeviceRGB',
      Coords: [grad.from[0], grad.from[1], grad.to[0], grad.to[1]],
      Function: stopsFunction(doc, stops),
      Extend: [true, true],
    }),
  );
}

export function gradientHasAlpha(grad: LinearGradient): boolean {
  return grad.stops.some((s) => s.alpha !== undefined && s.alpha < 1);
}

/**
 * ExtGState with a luminosity SMask whose gray ramp is the gradient's alpha
 * ramp. `bbox` (display-list space) must cover everything the mask should
 * affect; outside it the backdrop (BC black = fully transparent) applies.
 * `constantAlpha` (fill.alpha) multiplies in via CA/ca.
 */
export function buildAlphaScrimGState(
  doc: PDFDocument,
  grad: LinearGradient,
  bbox: Rect,
  constantAlpha = 1,
): PDFDict {
  const ctx = doc.context;
  const grayStops = normalizeStops(grad, (i) => [grad.stops[i]!.alpha ?? 1]);
  const grayShading = ctx.register(
    ctx.obj({
      ShadingType: 2,
      ColorSpace: 'DeviceGray',
      Coords: [grad.from[0], grad.from[1], grad.to[0], grad.to[1]],
      Function: stopsFunction(doc, grayStops),
      Extend: [true, true],
    }),
  );

  const content = '/Sh0 sh';
  const form = ctx.flateStream(content, {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [bbox.x, bbox.y, bbox.x + bbox.w, bbox.y + bbox.h],
    Group: { S: 'Transparency', CS: 'DeviceGray', I: true },
    Resources: { Shading: { Sh0: grayShading } },
  });
  const formRef = ctx.register(form);

  return ctx.obj({
    Type: 'ExtGState',
    SMask: ctx.obj({ Type: 'Mask', S: 'Luminosity', G: formRef, BC: [0] }),
    CA: constantAlpha,
    ca: constantAlpha,
  });
}

/** Plain alpha ExtGState. */
export function buildAlphaGState(doc: PDFDocument, fillAlpha: number, strokeAlpha: number): PDFDict {
  return doc.context.obj({ Type: 'ExtGState', ca: fillAlpha, CA: strokeAlpha });
}

/** Overprint ExtGState for automatic black overprint / explicit overprint. */
export function buildOverprintGState(doc: PDFDocument): PDFDict {
  const dict = doc.context.obj({ Type: 'ExtGState', OPM: 1 });
  dict.set(PDFName.of('OP'), doc.context.obj(true));
  dict.set(PDFName.of('op'), doc.context.obj(true));
  return dict;
}

/** ExtGState that resets transparency state (no SMask, full alpha). */
export function buildResetGState(doc: PDFDocument): PDFDict {
  const dict = doc.context.obj({ Type: 'ExtGState', CA: 1, ca: 1 });
  dict.set(PDFName.of('SMask'), PDFName.of('None'));
  return dict;
}
