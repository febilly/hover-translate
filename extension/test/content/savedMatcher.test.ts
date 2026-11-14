import { describe, expect, it } from "vitest";
import { canonicalize, findSavedMatches, CaptionPiece } from "../../src/content/utils/savedMatcher.ts";
import { splitIntoWords, renderWord } from "../../src/content/utils/wordSegmenter.ts";

/** The pieces of caption lines as the content script's spans carry them: a word and its separator. */
const lines = (...texts: string[]): CaptionPiece[] =>
  texts.flatMap((text) => splitIntoWords(text).map((word, index) => ({ text: renderWord(word), breakBefore: index === 0 })));

const find = (pieces: CaptionPiece[], ...saved: string[]) => {
  const keys = new Set(saved.map((text) => canonicalize(text).toLowerCase()));
  return findSavedMatches(pieces, (key) => keys.has(key), 100).map(({ first, last }) => [first, last]);
};

describe("canonicalize", () => {
  it("keeps one space between words, none around punctuation or between spaceless characters", () => {
    expect(canonicalize("  hello   world ")).toBe("hello world");
    expect(canonicalize("hello , world")).toBe("hello,world");
    expect(canonicalize("你 好 。")).toBe("你好。");
    expect(canonicalize("日本語 を 話す")).toBe("日本語を話す");
  });
});

describe("finding saved words in captions", () => {
  it("a word, a phrase, ignoring case", () => {
    const pieces = lines("Run for your life");
    expect(find(pieces, "run")).toEqual([[0, 0]]);
    expect(find(pieces, "FOR YOUR")).toEqual([[1, 2]]);
  });

  it("a phrase that wraps onto the next line", () => {
    expect(find(lines("run for", "your life"), "for your")).toEqual([[1, 2]]);
  });

  it("a line break stands for a space, and for nothing between spaceless characters", () => {
    expect(find(lines("hello", "world"), "hello world")).toEqual([[0, 1]]);
    expect(find(lines("hello", "world"), "helloworld")).toEqual([]);
    // Built by hand: how a browser's segmenter cuts 我喜 is its own business.
    const split: CaptionPiece[] = [{ text: "我喜" }, { text: "欢看", breakBefore: true }];
    expect(find(split, "喜欢")).toEqual([[0, 1]]);
  });

  it("punctuation is a unit of its own: it does not hide a word, and is matched when saved", () => {
    expect(find(lines("Well, run!"), "run")).toEqual([[1, 1]]);
    expect(find(lines("Well, run!"), "well run")).toEqual([]);
    expect(find(lines("Well, run!"), "well, run")).toEqual([[0, 1]]);
    expect(find(lines("it's well-known"), "well")).toEqual([[1, 1]]);
    expect(find(lines("it's well-known"), "it's")).toEqual([[0, 0]]);
  });

  it("CJK punctuation, quotes and brackets, full-width and ideographic spaces", () => {
    expect(find(lines("「こんにちは」。ありがとう"), "こんにちは")).toEqual([[0, 0]]);
    expect(find(lines("你好，世界！"), "世界")).toEqual([[1, 1]]);
    expect(find(lines("你好，世界！"), "你好，世界")).toEqual([[0, 1]]);
    expect(find(lines("안녕하세요, 세계!"), "세계")).toEqual([[1, 1]]);
    expect(find(lines("hello　world"), "hello world")).toEqual([[0, 1]]);
  });

  it("never inside a word", () => {
    expect(find(lines("lifetime of lifelong"), "life")).toEqual([]);
    expect(find(lines("a lifetime"), "time")).toEqual([]);
  });

  it("the longest saved text at a place wins; a text sharing a word with it waits", () => {
    expect(find(lines("run for your life"), "run", "run for", "for your life")).toEqual([[0, 1]]);
    expect(find(lines("run for your life"), "run", "your life")).toEqual([[0, 0], [2, 3]]);
  });

  it("the same text twice in a line", () => {
    expect(find(lines("run and run"), "run")).toEqual([[0, 0], [2, 2]]);
  });
});
