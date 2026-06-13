/**
 * Ambient typings for CJS dependencies that ship without their own, kept at
 * the repo root so every package program sees them — packages cross-import
 * each other's source (no build step), so these must be globally visible, not
 * tucked inside one package's `src`.
 */

declare module 'hypher' {
  interface HypherLanguage {
    id?: string;
    leftmin: number;
    rightmin: number;
    patterns: Record<string, string>;
    exceptions?: string;
  }
  class Hypher {
    constructor(language: HypherLanguage);
    leftMin: number;
    rightMin: number;
    /** 'hyphenation' -> ['hy','phen','ation'] (original casing preserved). */
    hyphenate(word: string): string[];
    hyphenateText(text: string, minLength?: number): string;
  }
  export = Hypher;
}

declare module 'hyphenation.en-us' {
  const language: {
    id: string;
    leftmin: number;
    rightmin: number;
    patterns: Record<string, string>;
  };
  export = language;
}

declare module 'rbush' {
  export interface RBushBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }

  export default class RBush<T extends RBushBox = RBushBox> {
    constructor(maxEntries?: number);
    insert(item: T): this;
    load(items: readonly T[]): this;
    remove(item: T, equals?: (a: T, b: T) => boolean): this;
    clear(): this;
    search(box: RBushBox): T[];
    all(): T[];
    collides(box: RBushBox): boolean;
  }
}
