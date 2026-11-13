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