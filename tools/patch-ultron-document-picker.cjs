const fs = require("node:fs");
const path = require("node:path");

const original = "      appContext.throwingActivity.startActivityForResult(intent, OPEN_DOCUMENT_CODE)";
const replacement = `      // ULTRON: a failed launch must not leave the native picker busy forever.
      try {
        appContext.throwingActivity.startActivityForResult(intent, OPEN_DOCUMENT_CODE)
      } catch (error: Exception) {
        pendingPromise = null
        throw error
      }`;
function patchDocumentPicker(source) {
  if (source.includes(replacement)) return source;
  if (source.split(original).length !== 2) throw new Error("Unexpected ExpoDocumentPicker source; review the launch cleanup patch.");
  return source.replace(original, replacement);
}
module.exports = { patchDocumentPicker };
if (require.main === module) {
  const root = path.dirname(require.resolve("expo-document-picker/package.json"));
  const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  if (version !== "57.0.0") throw new Error("Review native picker cleanup for expo-document-picker " + version);
  const file = path.join(root, "android/src/main/java/expo/modules/documentpicker/DocumentPickerModule.kt");
  fs.writeFileSync(file, patchDocumentPicker(fs.readFileSync(file, "utf8")));
  console.log("Expo document picker launch-failure cleanup applied.");
}
