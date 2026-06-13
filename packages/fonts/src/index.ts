/**
 * The font catalog. Every font available to guides and to the studio UI,
 * keyed by FontId. Files come from @expo-google-fonts packages (static
 * instances of Google Fonts, OFL-1.1) and are resolved to real paths only
 * on the server (see ./node.ts); the studio fetches bytes via the API.
 */

import type { FontFace } from '@guide/shared';

interface PkgSpec {
  pkg: string;
  family: string;
  prefix: string; // file name prefix, e.g. 'Fraunces'
  weights: { weight: number; name: string; italic?: boolean }[];
}

const W = (weight: number, name: string, italic = false) => ({ weight, name, italic });

const PACKAGES: PkgSpec[] = [
  {
    pkg: '@expo-google-fonts/fraunces',
    family: 'Fraunces',
    prefix: 'Fraunces',
    weights: [
      W(300, '300Light'),
      W(400, '400Regular'),
      W(400, '400Regular_Italic', true),
      W(500, '500Medium'),
      W(600, '600SemiBold'),
      W(600, '600SemiBold_Italic', true),
    ],
  },
  {
    pkg: '@expo-google-fonts/source-serif-4',
    family: 'Source Serif 4',
    prefix: 'SourceSerif4',
    weights: [
      W(400, '400Regular'),
      W(400, '400Regular_Italic', true),
      W(500, '500Medium'),
      W(600, '600SemiBold'),
    ],
  },
  {
    pkg: '@expo-google-fonts/archivo',
    family: 'Archivo',
    prefix: 'Archivo',
    weights: [W(400, '400Regular'), W(500, '500Medium'), W(600, '600SemiBold'), W(700, '700Bold')],
  },
  {
    pkg: '@expo-google-fonts/archivo-narrow',
    family: 'Archivo Narrow',
    prefix: 'ArchivoNarrow',
    weights: [W(400, '400Regular'), W(500, '500Medium'), W(600, '600SemiBold'), W(700, '700Bold')],
  },
  {
    pkg: '@expo-google-fonts/instrument-sans',
    family: 'Instrument Sans',
    prefix: 'InstrumentSans',
    weights: [W(400, '400Regular'), W(500, '500Medium'), W(600, '600SemiBold'), W(700, '700Bold')],
  },
  {
    pkg: '@expo-google-fonts/newsreader',
    family: 'Newsreader',
    prefix: 'Newsreader',
    weights: [
      W(400, '400Regular'),
      W(400, '400Regular_Italic', true),
      W(500, '500Medium'),
      W(500, '500Medium_Italic', true),
    ],
  },
  {
    pkg: '@expo-google-fonts/ibm-plex-mono',
    family: 'IBM Plex Mono',
    prefix: 'IBMPlexMono',
    weights: [W(400, '400Regular'), W(500, '500Medium')],
  },
];

function faceId(family: string, weight: number, italic: boolean): string {
  const slug = family.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return `${slug}-${weight}${italic ? 'i' : ''}`;
}

export const FONT_FACES: FontFace[] = PACKAGES.flatMap((p) =>
  p.weights.map(({ weight, name, italic }) => ({
    id: faceId(p.family, weight, italic ?? false),
    family: p.family,
    weight,
    italic: italic ?? false,
    file: `${p.pkg}/${name}/${p.prefix}_${name}.ttf`,
    license: 'OFL-1.1',
  })),
);

export const FACE_BY_ID: ReadonlyMap<string, FontFace> = new Map(
  FONT_FACES.map((f) => [f.id, f]),
);

export function findFace(family: string, weight: number, italic = false): FontFace | undefined {
  let best: FontFace | undefined;
  let bestDist = Infinity;
  for (const f of FONT_FACES) {
    if (f.family !== family || f.italic !== italic) continue;
    const d = Math.abs(f.weight - weight);
    if (d < bestDist) {
      best = f;
      bestDist = d;
    }
  }
  return best;
}
