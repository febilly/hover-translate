import { StorageService } from "../../common/services/storageService.ts";
import { TranslationData } from "../../common/types/translations.ts";
import { canonicalize } from "../utils/savedMatcher.ts";

/** The key a saved text is matched by: case and spacing do not matter (see `canonicalize`). */
export const savedKey = (text: string): string => canonicalize(text).toLowerCase();

/** Saved texts longer than this are never looked for in the captions. */
const MAX_KEY_LENGTH = 100;

/**
 * The saved dictionary entries as the content script needs them: a set of
 * texts, used to highlight those texts in the captions and to unsave one with
 * a click. `savedTranslations` in the local storage stays the single source of
 * truth; this follows it through `storage.onChanged`, so a word saved here, in
 * another tab or deleted in the popup is reflected everywhere.
 */
class SavedWords {
  private keys = new Set<string>();
  private longestKey = 0;
  private listeners = new Set<() => void>();
  private initialized = false;

  constructor(private readonly storageService: StorageService = new StorageService()) {}

  init() {
    if (this.initialized) return;
    this.initialized = true;

    this.storageService.get<TranslationData[]>("savedTranslations", "local")
      .then((saved) => this.setEntries(saved))
      .catch((error) => console.error("Could not read the saved words", error));

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.savedTranslations) {
        this.setEntries(changes.savedTranslations.newValue as TranslationData[] | undefined);
      }
    });
  }

  /** Whether this key (from `savedKey`) is a saved text. */
  has(key: string): boolean {
    return this.keys.has(key);
  }

  /** The length of the longest saved text worth looking for. */
  get maxKeyLength(): number {
    return this.longestKey;
  }

  get size(): number {
    return this.keys.size;
  }

  /** Called whenever the set of saved texts changes. */
  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  /** Deletes every saved entry whose original text is `text` (any language pair). */
  async remove(text: string): Promise<void> {
    const key = savedKey(text);
    await this.storageService.update<TranslationData[]>("savedTranslations", "local", (current) =>
      (current ?? []).filter((entry) => savedKey(entry.originalText) !== key),
    );
  }

  private setEntries(entries: TranslationData[] | null | undefined) {
    this.keys = new Set((entries ?? []).map((entry) => savedKey(entry.originalText)).filter((key) => key && [...key].length <= MAX_KEY_LENGTH));
    this.longestKey = Math.max(0, ...Array.from(this.keys, (key) => [...key].length));
    this.listeners.forEach((listener) => listener());
  }
}

export const savedWords = new SavedWords();
