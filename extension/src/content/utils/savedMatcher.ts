import { SPACELESS_SCRIPTS } from "./wordSegmenter.ts";

/**
 * Finding saved words and phrases in a caption, whatever way the caption is cut
 * into lines and spans.
 *
 * Every punctuation mark or symbol of any script (`,` `。` `「` `…` `-` `'`) is
 * a unit of its own, as is every character of a script written without spaces
 * (Han, kana, Thai…); only the characters of other scripts make up words. A
 * space matters only between two such word characters, and a line break counts
 * as one: `hello` at the end of a line and `world` at the start of the next is
 * `hello world`, while `你` and `好` on two lines stay `你好`.
 */

/** A piece of a caption (a word's span); `breakBefore` is set on the first piece of a new line. */
export interface CaptionPiece {
  text: string;
  breakBefore?: boolean;
}

export interface SavedMatch {
  /** The first and last piece the match touches. */
  first: number;
  last: number;
  /** The saved text it matched, as `canonicalize` writes it, lower case. */
  key: string;
}

const WHITESPACE = /\s/u;
const PUNCTUATION = /[\p{P}\p{S}]/u;

const isWordChar = (char: string | undefined): boolean =>
  char !== undefined && !WHITESPACE.test(char) && !PUNCTUATION.test(char) && !SPACELESS_SCRIPTS.test(char);

/** The characters of the pieces without the spaces that do not matter, and the piece each came from. */
const canonicalChars = (pieces: CaptionPiece[]): { chars: string[]; owners: number[] } => {
  const chars: string[] = [];
  const owners: number[] = [];
  let spaceBefore = false;

  pieces.forEach((piece, index) => {
    if (piece.breakBefore) spaceBefore = true;

    for (const char of piece.text) {
      if (WHITESPACE.test(char)) {
        spaceBefore = true;
        continue;
      }

      if (spaceBefore && isWordChar(char) && isWordChar(chars[chars.length - 1])) {
        chars.push(" ");
        owners.push(index);
      }
      chars.push(char);
      owners.push(index);
      spaceBefore = false;
    }
  });

  return { chars, owners };
};

/** The form a text is compared in, before lower-casing: only the spaces that matter are left, as one space. */
export const canonicalize = (text: string): string => canonicalChars([{ text }]).chars.join("");

/**
 * The saved texts found in `pieces`, from left to right, the longest first and
 * none overlapping. `has` tells whether a lower-case canonical text is saved;
 * no saved text is longer than `maxLength` characters. A match never starts or
 * ends inside a word: `life` is not in `lifetime`.
 */
export const findSavedMatches = (
  pieces: CaptionPiece[],
  has: (key: string) => boolean,
  maxLength: number,
): SavedMatch[] => {
  const { chars, owners } = canonicalChars(pieces);
  const matches: SavedMatch[] = [];
  let lastTaken = -1;
  let start = 0;

  while (start < chars.length) {
    let length = 0;

    // Pieces are shared by neighbouring matches only through one span: the later one waits.
    if (chars[start] !== " " && owners[start] > lastTaken && !(isWordChar(chars[start]) && isWordChar(chars[start - 1]))) {
      for (let candidate = Math.min(maxLength, chars.length - start); candidate >= 1; candidate--) {
        const end = start + candidate;
        if (chars[end - 1] === " " || (isWordChar(chars[end - 1]) && isWordChar(chars[end]))) continue;

        const key = chars.slice(start, end).join("").toLowerCase();
        if (has(key)) {
          matches.push({ first: owners[start], last: owners[end - 1], key });
          lastTaken = owners[end - 1];
          length = candidate;
          break;
        }
      }
    }

    start += length || 1;
  }

  return matches;
};
