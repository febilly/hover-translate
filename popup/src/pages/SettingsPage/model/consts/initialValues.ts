import { SettingsFormValues } from "../types/schema.ts";

export const initialFormValues: SettingsFormValues = {
  sourceLanguageCode: "auto",
  targetLanguageCode: "en",
  autoPause: true,
  translator: "google",
  leftClickAction: "save-to-dictionary",
  alwaysMultipleSelection: false,
  showNotifications: true,
  fixCaptionPosition: true,
  seekOnCtrlClick: true,
  seekLeadSeconds: 0.5,
};