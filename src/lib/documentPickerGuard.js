// Acquire synchronously, before any native call. Ignore duplicate taps rather
// than queueing another picker or processing the first result twice.
export function createExclusiveDocumentPicker(open, protectActivity) {
  let picking = false;
  return async (options) => {
    if (picking) return { canceled: true, assets: null };
    picking = true;
    try { return await protectActivity(() => open(options)); }
    finally { picking = false; }
  };
}
