/**
 * Generates src/icc/builtin.ts from the programmatic profile generator.
 * Run once (and whenever the device model changes):
 *   cd packages/press && pnpm exec tsx scripts/build-icc.ts
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateCmykProfile, PROFILE_DESCRIPTION } from '../src/icc/generate.js';

const bytes = generateCmykProfile();
const b64 = Buffer.from(bytes).toString('base64');

// Wrap the base64 payload for readable diffs.
const lines: string[] = [];
for (let i = 0; i < b64.length; i += 120) lines.push(b64.slice(i, i + 120));

const out = `/**
 * GENERATED FILE — do not edit. Rebuild with:
 *   pnpm exec tsx scripts/build-icc.ts
 *
 * Base64 of the programmatically generated '${PROFILE_DESCRIPTION}' ICC
 * profile (v2.4, prtr, CMYK -> Lab, D50). ${bytes.length} bytes.
 */

import type { IccProfile } from '../types.js';

const B64 =
${lines.map((l) => `  '${l}'`).join(' +\n')};

function decode(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const BUILTIN_CMYK_PROFILE: IccProfile = {
  name: '${PROFILE_DESCRIPTION}',
  bytes: decode(B64),
};
`;

const dir = dirname(fileURLToPath(import.meta.url));
const target = join(dir, '../src/icc/builtin.ts');
writeFileSync(target, out);
console.log(`wrote ${target} (${bytes.length} profile bytes, ${out.length} ts bytes)`);
