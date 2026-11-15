import { TOOLTIP_WORD_CLASS, TOOLTIP_SAVED_WORD_CLASS, CAPTION_SEGMENT, CAPTION_WINDOW, CAPTION_VISUAL_LINE, CAPTION_HISTORY_CLASS, DATA_ATTRIBUTES } from "../consts/consts.ts";
import { TooltipService } from "../services/tooltipService.ts";
import { state } from "../state/stateManager.ts";
import { CaptionWord, renderWord, splitIntoWords } from "../utils/wordSegmenter.ts";
import { isShiftHeld } from "../utils/shiftKey.ts";
import { fillWordSpan, findVisibleCaptionSegment, getPlayerVideo } from "../utils/domUtils.ts";
import { savedWords } from "../state/savedWords.ts";
import { findSavedMatches } from "../utils/savedMatcher.ts";

export class SubtitleCore {
  /**
   * Words this instance last split each caption line into. It is what makes an
   * unchanged (or merely extended) line recognisable, and it is per instance on
   * purpose: after the pipeline is rebuilt the spans still on screen carry
   * handlers of the previous instance, so the new one has to re-split them.
   *
   * It also recognises a line YouTube removed and drew again as a new node,
   * which it does to every line that stays when auto-generated captions roll
   * up: its spans move to the new line, so a selection on it and a
   * translation still loading for it survive.
   */
  private readonly parsedSegments = new WeakMap<HTMLElement, CaptionWord[]>();

  /** Lines we took out of the history ourselves: their removal is not YouTube's. */
  private readonly droppedLines = new WeakSet<Node>();

  constructor(
    private readonly tooltipService: TooltipService
  ) {
    savedWords.onChange(this.highlightSavedWords);
  }

  /**
   * Marks the words that make up a saved word or phrase, so they are drawn in
   * yellow and a click on them unsaves the text. Looked for across the whole
   * caption window, so a phrase that wraps onto the next line is found too
   * (`findSavedMatches`). Runs again whenever the words or the saved set change.
   */
  public highlightSavedWords = (): void => {
    document.querySelectorAll<HTMLElement>(`.${TOOLTIP_WORD_CLASS}`).forEach((word) => {
      word.classList.remove(TOOLTIP_SAVED_WORD_CLASS);
      word.removeAttribute(DATA_ATTRIBUTES.SAVED);
      word.removeAttribute(DATA_ATTRIBUTES.SAVED_GROUP);
    });
    if (savedWords.size === 0) return;

    let groupId = 0;

    document.querySelectorAll<HTMLElement>(`.${CAPTION_WINDOW}`).forEach((captionWindow) => {
      const words = Array.from(captionWindow.querySelectorAll<HTMLElement>(`.${TOOLTIP_WORD_CLASS}`));
      const pieces = words.map((word, index) => ({
        text: word.textContent ?? "",
        breakBefore: index > 0 && word.parentElement !== words[index - 1].parentElement,
      }));

      findSavedMatches(pieces, (key) => savedWords.has(key), savedWords.maxKeyLength).forEach(({ first, last, key }) => {
        words.slice(first, last + 1).forEach((word) => {
          word.classList.add(TOOLTIP_SAVED_WORD_CLASS);
          word.setAttribute(DATA_ATTRIBUTES.SAVED, key);
          word.setAttribute(DATA_ATTRIBUTES.SAVED_GROUP, String(groupId));
        });
        groupId++;
      });
    });
  };

  public setWordsIndexes = () => {
    const allWords = document.querySelectorAll(`.${TOOLTIP_WORD_CLASS}`);
    allWords.forEach((word, index) => {
      if (word instanceof HTMLElement) {
        word.setAttribute(DATA_ATTRIBUTES.INDEX, String(index));
      }
    });
    this.highlightSavedWords();
  };

  /**
   * Turns a caption line into one span per word, and reports whether the DOM was
   * actually touched.
   *
   * The line is left completely alone when it still holds exactly the words we
   * split it into last time; when it changed, the spans `countKeptWords` allows
   * stay and only the rest of the line is built again. Rebuilding the line
   * unconditionally is what broke selections: auto-generated captions are
   * re-rendered on every appended word, and each rebuild detached the very
   * nodes the current selection was anchored to.
   *
   * `removedLines`: caption lines that left the page in the same change, whose
   * spans this line may take over (see `parsedSegments`).
   */
  public splitCaptionIntoSpans(captionSegment: HTMLElement, removedLines: HTMLElement[] = []): boolean {
    const text = captionSegment.textContent?.trim() ?? "";
    const words = splitIntoWords(text);
    const ownWords = this.getParsedWords(captionSegment);

    if (ownWords && this.isSameWords(ownWords, words)) return false;

    const parsedWords = ownWords ?? this.takeOverRemovedLine(captionSegment, removedLines, words);

    const keptCount = parsedWords ? this.countKeptWords(parsedWords, words) : 0;

    if (keptCount > 0) {
      // Drop YouTube's raw text and the spans past the kept ones.
      this.removeNonWordNodes(captionSegment);
      captionSegment.querySelectorAll(`.${TOOLTIP_WORD_CLASS}`).forEach((wordNode, index) => {
        if (index >= keptCount) wordNode.remove();
      });
      this.renderKeptWords(captionSegment, words.slice(0, keptCount));
      captionSegment.appendChild(this.buildWordSpans(words.slice(keptCount), captionSegment));
      this.parsedSegments.set(captionSegment, words);
      return true;
    }

    const fragment = this.buildWordSpans(words, captionSegment);

    captionSegment.textContent = "";
    captionSegment.appendChild(fragment);
    this.parsedSegments.set(captionSegment, words);

    return true;
  }

  /**
   * The words we split this line into, or null when the line was never split by
   * this instance or its spans have since been replaced by YouTube.
   */
  private getParsedWords(captionSegment: HTMLElement): CaptionWord[] | null {
    const parsedWords = this.parsedSegments.get(captionSegment);
    if (!parsedWords) return null;

    const wordNodes = captionSegment.querySelectorAll(`.${TOOLTIP_WORD_CLASS}`);
    if (wordNodes.length !== parsedWords.length) return null;

    const isIntact = parsedWords.every(
      (word, index) => wordNodes[index].textContent?.trim() === renderWord(word).trim()
    );

    return isIntact ? parsedWords : null;
  }

  /**
   * Moves the spans of the removed line that keeps the most of them in these
   * words (`countKeptWords`) to the end of `captionSegment`, and returns its
   * words; null when none keeps any. Its spans gone, the removed line can't be
   * taken twice.
   *
   * The most, not the first: the line that went may be the start of the one
   * that stays ("you know" above "you know what I mean"). Of two that keep as
   * many, the one that loses fewer: the line that went may also start like the
   * one that stays, and only grown ("in my hometown because…" above
   * "in my hometown.").
   */
  private takeOverRemovedLine(captionSegment: HTMLElement, removedLines: HTMLElement[], words: CaptionWord[]): CaptionWord[] | null {
    let takenLine: HTMLElement | null = null;
    let takenWords: CaptionWord[] = [];
    let takenCount = 0;

    for (const removedLine of removedLines) {
      const removedWords = this.getParsedWords(removedLine);
      const keptCount = removedWords ? this.countKeptWords(removedWords, words) : 0;
      if (removedWords && (keptCount > takenCount || (keptCount === takenCount && removedWords.length < takenWords.length))) {
        takenLine = removedLine;
        takenWords = removedWords;
        takenCount = keptCount;
      }
    }

    if (!takenLine) return null;

    captionSegment.append(...Array.from(takenLine.querySelectorAll(`.${TOOLTIP_WORD_CLASS}`)));
    this.parsedSegments.set(captionSegment, takenWords);
    return takenWords;
  }

  private isSameWords(words: CaptionWord[], otherWords: CaptionWord[]): boolean {
    return words.length === otherWords.length &&
      words.every((word, index) => renderWord(word) === renderWord(otherWords[index]));
  }

  /**
   * How many spans of the parsed words the line now holding `words` keeps: the
   * words it still starts with, and the next one too when it has only grown
   * (`っ` → `って`, `hometown` → `hometown.`). YouTube grows a line by pieces,
   * not always whole words, and `Intl.Segmenter` decides the end of a line
   * without spaces anew each time; a selection on the word that grew stays,
   * and one reaching past it is dropped (`TooltipService.refreshSelectedWords`).
   *
   * Only the words themselves are compared, not what is rendered after them: in
   * a script without spaces the last word of a line loses its trailing space as
   * soon as the next word arrives (`我喜欢` → `我喜欢看`). Treating that as a
   * different line would rebuild the whole caption on every appended word, and a
   * rebuild detaches the very nodes a live selection is anchored to.
   */
  private countKeptWords(parsedWords: CaptionWord[], words: CaptionWord[]): number {
    let count = 0;
    while (count < parsedWords.length && count < words.length && parsedWords[count].text === words[count].text) count++;

    const grown = count < parsedWords.length && count < words.length && words[count].text.startsWith(parsedWords[count].text);
    return grown ? count + 1 : count;
  }

  /**
   * Brings the spans that stay in line with their words and what now follows
   * them — see `countKeptWords`. The nodes are kept, so the selection survives.
   */
  private renderKeptWords(captionSegment: HTMLElement, words: CaptionWord[]): void {
    const wordNodes = captionSegment.querySelectorAll(`.${TOOLTIP_WORD_CLASS}`);

    words.forEach((word, index) => {
      const wordNode = wordNodes[index];
      const rendered = renderWord(word);

      if (wordNode && wordNode.textContent !== rendered) {
        fillWordSpan(wordNode as HTMLElement, rendered);
      }
    });
  }

  private removeNonWordNodes(captionSegment: HTMLElement): void {
    Array.from(captionSegment.childNodes).forEach((child) => {
      if (child instanceof HTMLElement && child.classList.contains(TOOLTIP_WORD_CLASS)) return;
      child.remove();
    });
  }

  /**
   * Each new span is stamped with the video's time: the moment a word shows up
   * is the closest thing to when it is said that the page gives (YouTube's
   * markup carries no times). For auto-generated captions that is one time per
   * word, as they are appended; a line of manual captions comes at once, at
   * its start. The words a line keeps through a redraw keep their stamp.
   */
  private buildWordSpans(words: CaptionWord[], captionSegment: HTMLElement): DocumentFragment {
    const fragment = document.createDocumentFragment();
    const time = getPlayerVideo(captionSegment)?.currentTime;

    words.forEach((word) => {
      const wordSpan = this.createWordSpan(word);
      if (time !== undefined && Number.isFinite(time)) wordSpan.setAttribute(DATA_ATTRIBUTES.TIME, String(time));
      fragment.appendChild(wordSpan);
    });

    return fragment;
  }

  private createWordSpan(word: CaptionWord): HTMLSpanElement {
    const wordSpan = document.createElement("span");
    wordSpan.classList.add(TOOLTIP_WORD_CLASS);
    fillWordSpan(wordSpan, renderWord(word));
    wordSpan.addEventListener("pointerenter", this.tooltipService.handleWordMouseEnter);
    wordSpan.addEventListener("pointerleave", this.tooltipService.handleWordMouseLeave);
    let isDrag = false;
    let startX = 0;
    let startY = 0;
    const DRAG_THRESHOLD = 5;

    // Only the main button acts on the word: a right click opens the context
    // menu, and a middle click is not a click on the word either.
    wordSpan.addEventListener("pointerdown", (e: PointerEvent) => {
      if (e.button !== 0) return;
      // Save the initial coordinates and reset the "drag" flag
      isDrag = false;
      startX = e.clientX;
      startY = e.clientY;
    });

    const isFarFromPress = (e: PointerEvent) =>
      Math.abs(e.clientX - startX) > DRAG_THRESHOLD || Math.abs(e.clientY - startY) > DRAG_THRESHOLD;

    wordSpan.addEventListener("pointermove", (e: PointerEvent) => {
      this.tooltipService.handleWordPointerMove(e, wordSpan);
      // If the cursor has moved further than the threshold, set the "drag" flag
      if (isFarFromPress(e)) {
        isDrag = true;
      }
    });

    wordSpan.addEventListener("pointerup", (e: PointerEvent) => {
      // If the user is dragging the subtitles, don't save the translation or copy the text.
      // The release is measured too: YouTube moves the caption window after
      // the pointer, so each move of a drag lands beside the word, the word
      // gets no `pointermove` at all, and the release is on it again.
      // Ctrl+click is no click action: it takes the video to the word (on a Mac
      // it is also the right click, yet it comes as the main button).
      if (e.button === 0 && e.ctrlKey && !isDrag && !isFarFromPress(e)) {
        if (state.settings.seekOnCtrlClick) this.seekToWord(wordSpan);
        return;
      }

      if (e.button === 0 && !e.ctrlKey && !isDrag && !isFarFromPress(e)) {
        switch (state.settings.leftClickAction) {
        case "save-to-dictionary": {
          // A highlighted (already saved) word: the click unsaves it.
          const savedText = wordSpan.getAttribute(DATA_ATTRIBUTES.SAVED);
          if (savedText) {
            this.tooltipService.removeSavedTranslation(wordSpan, savedText);
            break;
          }
          this.tooltipService.saveTranslationToDictionary(wordSpan);
          break;
        }
        case "copy-original":
          this.tooltipService.saveOriginalTextToClipboard(wordSpan);
          break;
        case "copy-translation":
          this.tooltipService.saveTranslationToClipboard(wordSpan);
          break;
        case "nothing":
          break;
        default:
          break;
        }
      }
    });

    return wordSpan;
  }

  /**
   * More lines of auto-generated captions than YouTube's two
   * (`autoCaptionLines`). Rolling up, YouTube removes every line of the window
   * and adds back the ones that stay, which take over the words of the removed
   * ones; a removed line that still has its words is the one that went. It is
   * put back above YouTube's own lines, in a block of ours, and the oldest ones
   * go once the window holds more lines than set. YouTube only removes the
   * lines it made: should it ever take our block too, it is put back.
   *
   * Returns whether words came or went, so that they are indexed again.
   */
  public keepRolledOutLines(mutations: MutationRecord[]): boolean {
    const maxLines = state.settings.autoCaptionLines ?? 2;
    if (maxLines <= 2 && !document.querySelector(`.${CAPTION_HISTORY_CLASS}`)) return false;

    let changed = false;

    mutations.forEach(({ target, removedNodes }) => {
      if (!(target instanceof HTMLElement) || !target.isConnected || !target.closest(`.${CAPTION_WINDOW}`)) return;
      if (target.classList.contains(CAPTION_HISTORY_CLASS)) return;

      removedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement) || this.droppedLines.has(node)) return;

        if (node.classList.contains(CAPTION_HISTORY_CLASS)) {
          target.prepend(node);
          changed = true;
        } else if (node.classList.contains(CAPTION_VISUAL_LINE) && node.querySelector(`.${TOOLTIP_WORD_CLASS}`)) {
          this.getHistory(target).append(node);
          changed = true;
        }
      });
    });

    document.querySelectorAll<HTMLElement>(`.${CAPTION_HISTORY_CLASS}`).forEach((history) => {
      const ownLines = history.parentElement?.querySelectorAll(`:scope > .${CAPTION_VISUAL_LINE}`).length ?? 0;
      const lines = Array.from(history.children);
      const extra = lines.length - Math.max(0, maxLines - ownLines);

      lines.slice(0, Math.max(0, extra)).forEach((line) => this.dropLine(line));
      if (history.children.length === 0) this.dropLine(history);
      changed = changed || extra > 0;
    });

    if (changed) this.updateCaptionWindowSize();
    return changed;
  }

  private getHistory(captionsText: HTMLElement): HTMLElement {
    const existing = captionsText.querySelector<HTMLElement>(`:scope > .${CAPTION_HISTORY_CLASS}`);
    if (existing) return existing;

    const history = document.createElement("span");
    history.className = CAPTION_HISTORY_CLASS;
    captionsText.prepend(history);
    return history;
  }

  private dropLine(node: Element): void {
    this.droppedLines.add(node);
    node.remove();
  }

  /** Starts the video a little before the moment the word appeared (`seekLeadSeconds`). */
  private seekToWord(wordSpan: HTMLElement): void {
    const stamp = wordSpan.getAttribute(DATA_ATTRIBUTES.TIME);
    const video = getPlayerVideo(wordSpan);
    if (stamp === null || !video) return;

    const lead = Math.max(0, Number(state.settings.seekLeadSeconds) || 0);
    video.currentTime = Math.max(0, Number(stamp) - lead);
    // Autoplay policies can refuse this; the click is a gesture, so they rarely do.
    video.play().catch(() => {
      /* the browser declined to start the video */
    });
  }

  /**
   * For auto-generated captions YouTube makes the window wider than its text,
   * and auto-pause goes by the pointer entering the window, so the video
   * stopped over the empty part. Each window is narrowed to its own longest
   * line: a page can have several (two speakers, the miniplayer and a
   * thumbnail preview). A window whose lines measure 0 (none, or hidden) is
   * left as YouTube made it.
   */
  public updateCaptionWindowSize(): void {
    document.querySelectorAll(`.${CAPTION_WINDOW}`).forEach((captionWindow) => {
      const width = Math.max(0, ...Array.from(captionWindow.querySelectorAll(`.${CAPTION_SEGMENT}`))
        .map((segment) => segment.getBoundingClientRect().width));
      if (captionWindow instanceof HTMLElement && width > 0) {
        captionWindow.style.width = `${width}px`;
      }
    });
  }

  /**
   * A window without visible text lets the pointer through to the one under
   * it (styles.css): a styled track draws some lines twice, a transparent copy
   * in another font over the visible line, and the pointer took the copy's
   * words. An attribute rather than the window's inline style, which may set
   * `pointer-events` itself (the welcome page's demo); YouTube makes the
   * window anew when the player changes size (live, 2026-10-22), and the new
   * one comes through the observer. A window without segments yet waits for
   * them the same way.
   */
  public updateCaptionWindowPointerEvents(): void {
    document.querySelectorAll(`.${CAPTION_WINDOW}`).forEach((captionWindow) => {
      captionWindow.toggleAttribute(DATA_ATTRIBUTES.NO_VISIBLE_TEXT, !findVisibleCaptionSegment(captionWindow));
    });
  }

  public handlePointerLeaveOnCaptionWindow = ((event: Event) => {
    // Not the event's own Shift: Chrome outside macOS sends some boundary
    // events without it (see shiftKey.ts).
    if (state.settings.alwaysMultipleSelection && !isShiftHeld(event as PointerEvent)) {
      this.tooltipService.clearSelectedWords();
    }
  }) as EventListener;
}
