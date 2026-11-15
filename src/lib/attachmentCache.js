import * as FileSystem from "expo-file-system/legacy";

const jobs = new Set();
let clearing = null;

export function writeCachedAttachment(operation) {
  if (clearing) return Promise.reject(new Error("Cache degli allegati in aggiornamento."));
  const job = Promise.resolve().then(operation);
  jobs.add(job);
  return job.finally(() => jobs.delete(job));
}

export function clearAttachmentCache() {
  if (clearing) return clearing;
  clearing = (async () => {
    await Promise.allSettled(jobs);
    const dir = FileSystem.cacheDirectory;
    if (!dir) return;
    for (const entry of await FileSystem.readDirectoryAsync(dir)) {
      if (/^att_[\da-f]{64}_/.test(entry)) await FileSystem.deleteAsync(dir + entry, { idempotent: true });
    }
  })().finally(() => { clearing = null; });
  return clearing;
}
