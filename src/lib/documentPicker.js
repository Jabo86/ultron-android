import * as NativeDocumentPicker from "expo-document-picker";
import { withSystemActivity } from "./lockGuard";
import { createExclusiveDocumentPicker } from "./documentPickerGuard";

// One gate for the whole app, including key import, chat, groups and documents.
export const getDocumentAsync = createExclusiveDocumentPicker(
  options => NativeDocumentPicker.getDocumentAsync(options), withSystemActivity
);
