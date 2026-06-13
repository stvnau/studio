/**
 * English hyphenation (Knuth–Liang patterns via hypher). Tuned for print:
 * a word must be at least six letters long before we consider breaking it,
 * and at least three characters stay on each side of the break — anything
 * tighter reads badly at guide-book sizes. Results are cached because the
 * typesetter re-breaks paragraphs repeatedly during copyfit.
 */

import Hypher from 'hypher';
import english from 'hyphenation.en-us';

const MIN_WORD_LENGTH = 6;
const LEFT_MIN = 3;
const RIGHT_MIN = 3;

/** Splits off leading/trailing punctuation so "harbour," still hyphenates. */
const TRIM_RE = /^([^\p{L}\p{N}]*)([\s\S]*?)([^\p{L}\p{N}]*)$/u;

export function makeHyphenator(): (word: string) => string[] {
  const hypher = new Hypher({ ...english, leftmin: LEFT_MIN, rightmin: RIGHT_MIN });
  const cache = new Map<string, string[]>();

  return (word: string): string[] => {
    const hit = cache.get(word);
    if (hit) return hit;

    let parts: string[];
    const m = TRIM_RE.exec(word);
    const lead = m?.[1] ?? '';
    const core = m?.[2] ?? word;
    const trail = m?.[3] ?? '';

    if (core.length < MIN_WORD_LENGTH) {
      parts = [word];
    } else {
      const frags = hypher.hyphenate(core);
      if (frags.length <= 1) {
        parts = [word];
      } else {
        parts = frags.slice();
        // Restore stripped punctuation onto the outermost fragments so the
        // rendered word is byte-identical to the source.
        parts[0] = lead + parts[0]!;
        parts[parts.length - 1] = parts[parts.length - 1]! + trail;
      }
    }

    cache.set(word, parts);
    return parts;
  };
}
