export type Translator = "google" | "bing" | "deepl";
export type LeftClickAction = "nothing" | "copy-original" | "copy-translation" | "save-to-dictionary";

export interface Settings {
  sourceLanguageCode: string;
  targetLanguageCode: string;
  autoPause: boolean;
  translator: Translator;
  leftClickAction: LeftClickAction;
  alwaysMultipleSelection: boolean;
  showNotifications: boolean;
  /** Keeps the captions where they are instead of letting YouTube lift them when the pointer moves. */
  fixCaptionPosition: boolean;
  /** Ctrl+click on a caption word jumps the video to where the word appeared. */
  seekOnCtrlClick: boolean;
  /** Seconds before that moment to start from, so the word is not cut off. */
  seekLeadSeconds: number;
  /** How many lines of auto-generated captions to show; YouTube's own is 2, more keeps the lines it rolls out. */
  autoCaptionLines: number;
}

export interface TooltipTheme {
  useYouTubeSettings: boolean;
  fontFamily: string;
  fontColor: string;
  fontSize: string;
  backgroundColor: string;
  backgroundOpacity: string;
  characterEdgeStyle: string;
  fontOpacity: string;
}